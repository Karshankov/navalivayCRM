<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :title="title"
    :class="buttonClass"
    :aria-busy="loading || undefined"
    :aria-pressed="variant === 'filter' ? pressed : undefined"
    :aria-label="iconOnly ? ariaLabel : undefined"
    @click="$emit('click', $event)"
  >
    <svg
      v-if="refreshIcon"
      class="h-4 w-4 shrink-0"
      :class="{ 'animate-spin': loading }"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
    <template v-if="loading">
      <span aria-live="polite">{{ loadingLabel || "Загрузка..." }}</span>
      <span class="sr-only"><slot /></span>
    </template>
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";

type Variant =
  | "primary"
  | "secondary"
  | "soft"
  | "filter"
  | "success"
  | "muted"
  | "danger"
  | "danger-solid"
  | "ghost";
type Size = "md" | "sm";

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    type?: "button" | "submit";
    title?: string;
    refreshIcon?: boolean;
    loadingLabel?: string;
    block?: boolean;
    iconOnly?: boolean;
    ariaLabel?: string;
  }>(),
  {
    variant: "secondary",
    size: "md",
    loading: false,
    disabled: false,
    pressed: false,
    type: "button",
    title: undefined,
    refreshIcon: false,
    loadingLabel: undefined,
    block: false,
    iconOnly: false,
    ariaLabel: undefined,
  },
);

defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const buttonClass = computed(() => {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

  const sizes: Record<Size, string> = {
    md: props.iconOnly
      ? "min-h-[44px] min-w-[44px] rounded-xl text-sm"
      : "min-h-[44px] rounded-xl px-4 py-2.5 text-sm",
    sm: props.iconOnly
      ? "min-h-[44px] min-w-[44px] rounded-lg text-sm"
      : "min-h-[40px] rounded-lg px-3 py-2 text-xs sm:text-sm",
  };

  const variants: Record<Variant, string> = {
    primary:
      "bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700",
    secondary:
      "border border-slate-200/70 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50",
    soft: "border border-blue-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50",
    filter: props.pressed
      ? "border border-blue-200 bg-blue-50 text-blue-700"
      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
    success: "bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700",
    muted: "bg-slate-700 font-semibold text-white shadow-sm hover:bg-slate-800",
    danger: "border border-rose-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50",
    "danger-solid": "bg-rose-600 font-semibold text-white shadow-sm hover:bg-rose-700",
    ghost: "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
  };

  const iconOnlyGhost =
    props.iconOnly && props.variant === "ghost"
      ? "border-0 bg-transparent shadow-none opacity-70 hover:bg-black/5 hover:opacity-100"
      : "";

  return [base, props.block ? "w-full" : "", sizes[props.size], variants[props.variant], iconOnlyGhost]
    .filter(Boolean)
    .join(" ");
});
</script>