<template>
  <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4 space-y-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-gray-800">Показывать на кассе</p>
        <p class="text-xs text-gray-500 mt-1">
          Товары {{ scopeLabel }} появятся на заблокированном экране. Остатки списываются из каталога.
        </p>
      </div>
      <label class="inline-flex items-center shrink-0">
        <input
          v-model="published"
          type="checkbox"
          class="w-5 h-5 text-brand-dark border-gray-300 rounded"
          data-testid="pos-publication-toggle"
        />
      </label>
    </div>

    <div v-if="published" class="space-y-3 pt-1">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Цена на кассе, BYN</label>
        <input
          v-model.number="fixedPrice"
          type="number"
          min="0"
          step="0.01"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
          placeholder="Пусто — считать от розницы"
          data-testid="pos-fixed-price"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Наценка, +₽</label>
          <input
            v-model.number="markupAmount"
            type="number"
            min="0"
            step="0.01"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
            placeholder="0"
            data-testid="pos-markup-amount"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Наценка, +%</label>
          <input
            v-model.number="markupPercent"
            type="number"
            min="0"
            step="1"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
            placeholder="0"
            data-testid="pos-markup-percent"
          />
        </div>
      </div>

      <p class="text-xs text-gray-500 leading-relaxed">
        Если заполнена цена на кассе, она главнее наценки. Иначе к рознице прибавится сумма,
        затем процент от розницы.
      </p>

      <p class="text-[11px] text-gray-400 leading-relaxed">
        Наценка линейки перекрывает наценку категории.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * Опубликовать категорию или линейку на заблокированный экран кассы.
 *
 * Значения намеренно держим локально, а наружу отдаём через `update` события:
 * родительские формы собраны на vee-validate, и встраивать сюда ещё три поля
 * схемы значило бы ломать их черновики ради одного блока.
 */
export interface PosPublicationValue {
  published: boolean
  fixed_price: number | null
  markup_amount: number | null
  markup_percent: number | null
}

const props = withDefaults(
  defineProps<{
    modelValue?: PosPublicationValue | null
    scope?: 'category' | 'group'
  }>(),
  { modelValue: null, scope: 'group' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: PosPublicationValue): void
}>()

const scopeLabel = computed(() => (props.scope === 'category' ? 'категории' : 'линейки'))

const published = ref(false)
const fixedPrice = ref<number | null>(null)
const markupAmount = ref<number | null>(null)
const markupPercent = ref<number | null>(null)

function emptyToNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

watch(
  () => props.modelValue,
  (value) => {
    published.value = Boolean(value?.published)
    fixedPrice.value = value?.fixed_price ?? null
    markupAmount.value = value?.markup_amount ?? null
    markupPercent.value = value?.markup_percent ?? null
  },
  { immediate: true },
)

function emitValue() {
  emit('update:modelValue', {
    published: published.value,
    fixed_price: published.value ? emptyToNull(fixedPrice.value) : null,
    markup_amount: published.value ? emptyToNull(markupAmount.value) : null,
    markup_percent: published.value ? emptyToNull(markupPercent.value) : null,
  })
}

watch([published, fixedPrice, markupAmount, markupPercent], emitValue)
</script>