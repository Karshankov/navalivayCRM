<template>
  <div v-if="totalMinutes > 0" class="overflow-x-auto">
    <div class="min-w-[520px]">
      <div
        class="grid gap-px"
        :style="{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }"
        role="img"
        :aria-label="ariaLabel"
      >
        <div aria-hidden="true" />
        <div
          v-for="hour in hours"
          :key="`head-${hour}`"
          class="pb-1 text-center text-[10px] text-slate-400"
          aria-hidden="true"
        >
          {{ hour % 2 === 0 ? hour : "" }}
        </div>

        <template v-for="(day, dayIndex) in weekdays" :key="day">
          <div
            class="flex items-center pr-1.5 text-right text-[11px] font-medium text-slate-500"
            aria-hidden="true"
          >
            {{ day }}
          </div>
          <div
            v-for="hour in hours"
            :key="`${day}-${hour}`"
            class="h-5 rounded-[3px]"
            :style="cellStyle(dayIndex, hour)"
            :title="cellTitle(day, hour, dayIndex)"
          />
        </template>
      </div>

      <div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500">
        <span>Пик: {{ peakLabel }}</span>
        <div class="flex items-center gap-1.5">
          <span>меньше</span>
          <span
            v-for="step in legendSteps"
            :key="step"
            class="h-3 w-5 rounded-[3px]"
            :style="{ backgroundColor: shade(step) }"
            aria-hidden="true"
          />
          <span>больше</span>
        </div>
      </div>
    </div>
  </div>
  <p v-else class="py-8 text-center text-sm text-slate-500">
    За выбранный период смен не было
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { BUSINESS_TIME_ZONE } from "@/utils/businessTime";
import type { StaffShift } from "@/stores/crm";

const props = withDefaults(
  defineProps<{
    shifts: StaffShift[];
    color?: string;
  }>(),
  { color: "#2563eb" },
);

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const legendSteps = [0.15, 0.4, 0.65, 1];

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Смещение делового часового пояса относительно UTC на конкретный момент. */
function businessOffsetMs(timestamp: number) {
  const values: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - timestamp;
}

function toTimestamp(value?: string | null) {
  if (!value) return Number.NaN;
  const text = String(value).trim();
  if (!text) return Number.NaN;
  // SQLite отдаёт «2026-07-27 08:15:00» без зоны, это UTC.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  return new Date(normalized).getTime();
}

/** minutes[weekday 0..6][hour 0..23] */
const buckets = computed(() => {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const now = Date.now();
  for (const shift of props.shifts || []) {
    const start = toTimestamp(shift.started_at || shift.opened_at);
    const rawEnd = shift.ended_at || shift.closed_at;
    const end = rawEnd
      ? toTimestamp(rawEnd)
      : Math.min(now, toTimestamp(shift.planned_end_at) || now);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const offset = businessOffsetMs(start);
    let cursor = start + offset;
    const localEnd = end + offset;
    // Не даём одной битой записи съесть всю сетку.
    if (localEnd - cursor > 32 * 3_600_000) continue;

    while (cursor < localEnd) {
      const hourStart = Math.floor(cursor / 3_600_000) * 3_600_000;
      const sliceEnd = Math.min(hourStart + 3_600_000, localEnd);
      const minutes = (sliceEnd - cursor) / 60_000;
      const hour = Math.floor(cursor / 3_600_000) % 24;
      // getUTCDay по локальным мс: 0 это воскресенье, приводим к Пн=0.
      const weekday = (new Date(cursor).getUTCDay() + 6) % 7;
      grid[weekday][hour] += minutes;
      cursor = sliceEnd;
    }
  }
  return grid;
});

const totalMinutes = computed(() =>
  buckets.value.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0),
);

const hours = computed(() => {
  let min = 23;
  let max = 0;
  for (const row of buckets.value) {
    row.forEach((value, hour) => {
      if (value <= 0) return;
      if (hour < min) min = hour;
      if (hour > max) max = hour;
    });
  }
  if (min > max) return range(10, 22);
  return range(Math.max(0, min - 1), Math.min(23, max + 1));
});

const maxMinutes = computed(() =>
  Math.max(...buckets.value.flatMap((row) => row), 0),
);

const peak = computed(() => {
  let best = { weekday: 0, hour: 0, minutes: 0 };
  buckets.value.forEach((row, weekday) => {
    row.forEach((minutes, hour) => {
      if (minutes > best.minutes) best = { weekday, hour, minutes };
    });
  });
  return best;
});

const peakLabel = computed(() => {
  if (!peak.value.minutes) return "нет данных";
  return `${weekdays[peak.value.weekday]}, ${String(peak.value.hour).padStart(2, "0")}:00`;
});

const ariaLabel = computed(() => {
  if (!totalMinutes.value) return "Смен за период не было";
  return `Загруженность по дням недели и часам. Больше всего работы: ${peakLabel.value}. Всего отработано ${Math.round(totalMinutes.value / 60)} часов.`;
});

function intensity(weekday: number, hour: number) {
  if (!maxMinutes.value) return 0;
  return buckets.value[weekday][hour] / maxMinutes.value;
}

function shade(value: number) {
  if (value <= 0) return "#f1f5f9";
  const alpha = 0.15 + value * 0.85;
  return hexToRgba(props.color, alpha);
}

function cellStyle(weekday: number, hour: number) {
  return { backgroundColor: shade(intensity(weekday, hour)) };
}

function cellTitle(day: string, hour: number, weekday: number) {
  const minutes = Math.round(buckets.value[weekday][hour]);
  const clock = `${String(hour).padStart(2, "0")}:00`;
  if (!minutes) return `${day}, ${clock}: смен не было`;
  return `${day}, ${clock}: ${minutes} мин работы`;
}

function hexToRgba(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return `rgba(37, 99, 235, ${alpha})`;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
</script>
