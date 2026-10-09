<template>
  <section
    class="grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    :class="columnsClass"
  >
    <article
      v-for="item in items"
      :key="item.label"
      class="min-w-0 px-3 py-2"
    >
      <div class="truncate text-[11px] font-medium text-slate-500" :title="item.label">
        {{ item.label }}
      </div>
      <div class="mt-0.5 flex items-baseline gap-1.5">
        <span class="truncate text-lg font-bold leading-tight text-slate-950">{{ item.value }}</span>
        <span
          v-if="deltaOf(item)"
          class="shrink-0 text-[11px] font-semibold tabular-nums"
          :class="deltaOf(item)!.className"
          :title="deltaOf(item)!.title"
        >
          {{ deltaOf(item)!.text }}
        </span>
      </div>
      <div v-if="item.hint" class="truncate text-[11px] text-slate-400" :title="item.hint">
        {{ item.hint }}
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

export type StripMetric = {
  label: string;
  value: string | number;
  raw?: number;
  previous?: number;
  /** Рост показателя это плохо (например, отрицательные отметки). */
  lowerIsBetter?: boolean;
  /** Чем форматировать значение за прошлый период в подсказке. */
  format?: (value: number) => string;
  /** Уточнение под значением, например из чего оно сложилось. */
  hint?: string;
};

const props = withDefaults(
  defineProps<{
    items: StripMetric[];
    columns?: number;
  }>(),
  { columns: 4 },
);

const columnsClass = computed(() => {
  const map: Record<number, string> = {
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-3 lg:grid-cols-6",
  };
  return map[props.columns] || "sm:grid-cols-4";
});

function deltaOf(item: StripMetric) {
  if (item.raw === undefined || item.previous === undefined) return null;
  const current = Number(item.raw);
  const previous = Number(item.previous);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) {
    if (current === 0) return null;
    return {
      text: "новое",
      className: "text-slate-500",
      title: "За прошлый период показателя не было",
    };
  }
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(percent);
  if (rounded === 0) {
    return {
      text: "без изменений",
      className: "text-slate-400",
      title: "Столько же, сколько за прошлый период",
    };
  }
  const better = item.lowerIsBetter ? rounded < 0 : rounded > 0;
  return {
    text: `${rounded > 0 ? "+" : ""}${rounded}%`,
    className: better ? "text-emerald-600" : "text-rose-600",
    title: `За прошлый период: ${formatPrevious(item, previous)}`,
  };
}

function formatPrevious(item: StripMetric, value: number) {
  if (item.format) return item.format(value);
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}
</script>
