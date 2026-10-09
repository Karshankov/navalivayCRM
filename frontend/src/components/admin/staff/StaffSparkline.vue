<template>
  <svg
    class="block h-full w-full overflow-visible"
    :viewBox="`0 0 ${viewWidth} ${viewHeight}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="ariaLabel"
  >
    <polygon v-if="areaPoints" :points="areaPoints" :fill="color" opacity="0.12" />
    <polyline
      :points="linePoints"
      fill="none"
      :stroke="color"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
    <circle
      v-if="lastPoint"
      :cx="lastPoint.x"
      :cy="lastPoint.y"
      r="1.6"
      :fill="color"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    values: number[];
    color?: string;
    label?: string;
  }>(),
  { color: "#2563eb", label: "" },
);

const viewWidth = 100;
const viewHeight = 24;
const padding = 2;

const series = computed(() => props.values.map((value) => (Number.isFinite(value) ? value : 0)));

const points = computed(() => {
  const values = series.value;
  if (!values.length) return [];
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const usableHeight = viewHeight - padding * 2;
  const step = values.length > 1 ? viewWidth / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: values.length > 1 ? index * step : viewWidth / 2,
    y: padding + usableHeight - ((value - min) / span) * usableHeight,
  }));
});

const linePoints = computed(() =>
  points.value.map((point) => `${round(point.x)},${round(point.y)}`).join(" "),
);

const areaPoints = computed(() => {
  if (points.value.length < 2) return "";
  const first = points.value[0];
  const last = points.value[points.value.length - 1];
  return [
    `${round(first.x)},${viewHeight}`,
    linePoints.value,
    `${round(last.x)},${viewHeight}`,
  ].join(" ");
});

const lastPoint = computed(() => {
  const last = points.value[points.value.length - 1];
  if (!last) return null;
  return { x: round(last.x), y: round(last.y) };
});

const ariaLabel = computed(() => {
  if (props.label) return props.label;
  const values = series.value;
  if (!values.length) return "Данных нет";
  return `Динамика за ${values.length} дн. Минимум ${Math.min(...values)}, максимум ${Math.max(...values)}.`;
});

function round(value: number) {
  return Math.round(value * 100) / 100;
}
</script>
