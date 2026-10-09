<template>
  <section
    :class="[
      'relative overflow-hidden rounded-3xl border text-white shadow-xl',
      'bg-gradient-to-br',
      toneClasses.background,
      toneClasses.border
    ]"
  >
    <div class="pointer-events-none absolute inset-0">
      <div class="absolute -left-12 -top-12 h-44 w-44 rounded-full bg-white/15 blur-3xl"></div>
      <div class="absolute -bottom-16 right-0 h-52 w-52 rounded-full bg-white/10 blur-3xl"></div>
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_rgba(255,255,255,0))]"></div>
    </div>

    <div class="relative z-10 p-6 sm:p-8 lg:p-10">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-5 max-w-2xl">
          <div v-if="eyebrow || icon" class="flex flex-wrap items-center gap-3 text-white/80">
            <span
              v-if="icon"
              :class="[
                'inline-flex h-12 w-12 items-center justify-center rounded-2xl backdrop-blur-sm text-white shadow-lg',
                toneClasses.icon
              ]"
            >
              <component :is="icon" class="h-6 w-6" />
            </span>
            <span
              v-if="eyebrow"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.32em]"
            >
              {{ eyebrow }}
            </span>
          </div>

          <div class="space-y-3">
            <h1 class="text-2xl font-semibold leading-tight sm:text-3xl">
              {{ title }}
            </h1>
            <p v-if="description" class="text-sm text-white/80 sm:text-base">
              {{ description }}
            </p>
          </div>

          <div v-if="$slots.meta" class="flex flex-wrap gap-3 pt-1">
            <slot name="meta" />
          </div>
        </div>

        <div v-if="$slots.actions" class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          <slot name="actions" />
        </div>
      </div>

      <div v-if="$slots.default" class="mt-6">
        <slot />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'brand' | 'emerald' | 'amber' | 'violet' | 'slate'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  icon?: any
  eyebrow?: string
  tone?: Tone
}>(), {
  eyebrow: '',
  tone: 'brand'
})

const palette: Record<Tone, { background: string; border: string; icon: string }> = {
  brand: {
    background: 'from-brand-dark via-rose-600 to-brand-primary',
    border: 'border-brand-primary/30',
    icon: 'bg-white/15'
  },
  emerald: {
    background: 'from-emerald-700 via-emerald-600 to-teal-500',
    border: 'border-emerald-300/30',
    icon: 'bg-emerald-400/20'
  },
  amber: {
    background: 'from-amber-700 via-orange-600 to-rose-500',
    border: 'border-amber-300/30',
    icon: 'bg-white/15'
  },
  violet: {
    background: 'from-purple-700 via-fuchsia-600 to-pink-500',
    border: 'border-fuchsia-300/30',
    icon: 'bg-white/15'
  },
  slate: {
    background: 'from-slate-800 via-slate-700 to-slate-600',
    border: 'border-slate-300/20',
    icon: 'bg-white/10'
  }
}

const toneClasses = computed(() => palette[props.tone] ?? palette.brand)

const icon = computed(() => props.icon)
const eyebrow = computed(() => props.eyebrow)
const title = computed(() => props.title)
const description = computed(() => props.description)
</script>
