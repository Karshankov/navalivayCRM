<template>
  <form @submit.prevent="onSubmit" class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">Название линейки *</label>
      <input
        v-model="form.name"
        type="text"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-dark focus:border-transparent"
        placeholder="Например: PODGON"
        :class="{ 'border-red-300 focus:ring-red-500 focus:border-red-300': nameError }"
      />
      <p v-if="nameError" class="mt-1 text-sm text-red-600">{{ nameError }}</p>
    </div>

    <div v-if="showStrengthTier" class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Крепость для фильтра</label>
      <div class="flex flex-wrap gap-2">
        <label
          v-for="option in strengthOptions"
          :key="option.value"
          class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer"
          :class="form.strengthTier === option.value ? 'border-brand-dark bg-brand-dark/5 text-gray-900' : 'border-gray-200 text-gray-700'"
        >
          <input
            v-model="form.strengthTier"
            type="radio"
            class="text-brand-dark focus:ring-brand-dark/30"
            :value="option.value"
          />
          <span>{{ option.label }}</span>
        </label>
        <button
          type="button"
          class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-300"
          @click="form.strengthTier = ''"
        >
          Не задано
        </button>
      </div>
      <p class="text-xs text-gray-500">Используется в фильтре «Очень крепкие / Крепкие / Легкие» на витрине</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">Дополнительный параметр</label>
      <input
        v-model="form.metaValue"
        type="text"
        class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-brand-dark focus:border-transparent text-sm"
        placeholder="Крепость 60 мг или Затяжек 2000"
      />
      <p class="mt-1 text-xs text-gray-500">Показывается на витрине как единая строка</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">Минимальный остаток</label>
      <input
        v-model="form.minStockThreshold"
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-brand-dark focus:border-transparent text-sm"
        placeholder="Например 45"
      />
      <p class="mt-1 text-xs text-gray-500">
        Когда суммарный остаток линейки опустится ниже этого числа, она появится
        в плашке «Заканчивающиеся» в разделе Закупки. Если поле пустое,
        оповещение появится только при полном обнулении товара.
      </p>
    </div>

    <label
      class="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-blue-500/30"
      :class="form.totalControl
        ? 'border-blue-300 bg-blue-50'
        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'"
    >
      <input
        v-model="form.totalControl"
        type="checkbox"
        class="mt-0.5 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
      />
      <span>
        <span class="block text-sm font-semibold text-gray-800">Тотальный контроль</span>
        <span class="mt-1 block text-xs leading-5 text-gray-600">
          Показывать в «Закупках» общий остаток линейки и разбивку по товарам, вкусам или цветам.
        </span>
      </span>
    </label>

    <div
      class="rounded-2xl border p-4 transition"
      :class="form.discountEnabled
        ? 'border-rose-300 bg-rose-50'
        : 'border-gray-200 bg-white hover:border-gray-300'"
    >
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="form.discountEnabled"
          type="checkbox"
          class="mt-0.5 h-5 w-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500/30"
        />
        <span>
          <span class="block text-sm font-semibold text-gray-800">Скидка на всю линейку</span>
          <span class="mt-1 block text-xs leading-5 text-gray-600">
            Все вкусы линейки будут продаваться по этой цене. На витрине старая
            цена зачёркивается, рядом встаёт новая. Бонусы за такую покупку не
            начисляются и не списываются.
          </span>
        </span>
      </label>

      <div v-if="form.discountEnabled" class="mt-3 space-y-3 pl-8">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700" for="group-discount-price">
            Сколько будет стоить, BYN
          </label>
          <input
            id="group-discount-price"
            v-model="form.discountPrice"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-rose-500/30"
            placeholder="Например 12"
          />
          <p v-if="basePriceLabel" class="mt-1 text-xs text-gray-500">{{ basePriceLabel }}</p>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-700" for="group-discount-until">
            Скидка действует по
          </label>
          <input
            id="group-discount-until"
            v-model="form.discountUntil"
            type="date"
            class="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-rose-500/30"
          />
          <p class="mt-1 text-xs text-gray-500">
            {{ form.discountUntil ? 'В этот день скидка ещё работает, дальше цена вернётся сама.' : 'Без даты скидка держится, пока её не снимут.' }}
          </p>
        </div>
      </div>
    </div>

    <div
      class="rounded-2xl border p-4 transition"
      :class="form.isNew
        ? 'border-rose-300 bg-rose-50'
        : 'border-gray-200 bg-white hover:border-gray-300'"
    >
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="form.isNew"
          type="checkbox"
          class="mt-0.5 h-5 w-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500/30"
        />
        <span>
          <span class="block text-sm font-semibold text-gray-800">Пометить как новинку</span>
          <span class="mt-1 block text-xs leading-5 text-gray-600">
            Линейка поднимется в начало списка на витрине и получит красную
            плашку. Когда срок выйдет, плашка пропадёт, и линейка вернётся на
            своё место.
          </span>
        </span>
      </label>

      <div v-if="form.isNew" class="mt-3 flex flex-wrap items-center gap-2 pl-8">
        <label class="text-xs font-medium text-gray-700" for="group-new-days">Срок показа, дней</label>
        <input
          id="group-new-days"
          v-model="form.newDays"
          type="number"
          min="1"
          max="180"
          step="1"
          inputmode="numeric"
          class="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-rose-500/30"
        />
        <span class="text-xs text-gray-500">от 1 до 180</span>
      </div>
      <p v-if="newUntilLabel" class="mt-2 pl-8 text-xs text-gray-500">{{ newUntilLabel }}</p>
      <p v-if="newDaysLeftLabel" class="mt-1 pl-8 text-xs text-gray-500">{{ newDaysLeftLabel }}</p>
    </div>

    <div class="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/80 p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="text-sm font-medium text-gray-700">Оптовые цены</p>
          <p class="mt-0.5 text-xs text-gray-500">Заполнено {{ wholesaleFilledCount }} из {{ resolvedWholesaleTiers.length || 0 }}</p>
        </div>
        <div class="text-right text-xs text-gray-500">
          <p>Себестоимость</p>
          <p class="mt-0.5 text-sm font-semibold text-gray-900">{{ averageCostAutoLabel }}</p>
        </div>
      </div>

      <div v-if="resolvedWholesaleTiers.length" class="overflow-hidden rounded-xl border border-white bg-white shadow-sm">
        <div class="grid grid-cols-[84px_minmax(0,1fr)] border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <span>Уровень</span>
          <span>Цена, BYN</span>
        </div>
        <div
          v-for="tier in resolvedWholesaleTiers"
          :key="tier.id"
          class="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0"
        >
          <div class="min-w-0">
            <p class="text-sm font-semibold text-gray-900">{{ tier.code }}+</p>
            <p class="text-[11px] text-gray-500">{{ formatTierMinAmount(tier.minOrderAmount) }} минимум</p>
          </div>
          <div class="flex items-center gap-2">
            <input
              :id="`wholesale-price-${tier.code}`"
              v-model="wholesalePriceInputs[tier.code]"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
              placeholder="-"
            />
            <span class="text-xs font-medium text-gray-500">BYN</span>
          </div>
        </div>
      </div>

      <p v-else class="text-xs text-gray-500">
        Уровни опта загружаются. После сохранения можно будет заполнить цены.
      </p>
    </div>

      <div class="space-y-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span class="block text-sm font-medium text-gray-700">Обложка линейки</span>
        </div>
        <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs font-medium text-gray-600">
          <button
            type="button"
            class="px-3 py-1 rounded-md transition-colors"
            :class="coverMode === 'url' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'"
            @click="setCoverMode('url')"
          >
            Ссылка
          </button>
          <button
            type="button"
            class="px-3 py-1 rounded-md transition-colors"
            :class="coverMode === 'file' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'"
            @click="setCoverMode('file')"
          >
            Файл
          </button>
        </div>
      </div>

      <div
        v-if="hasPreview"
        class="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center"
      >
        <img
          :src="currentPreview"
          alt="Превью обложки"
          class="h-20 w-32 flex-shrink-0 rounded-lg object-cover ring-1 ring-white/80 shadow"
        />
        <div class="flex-1 space-y-1 text-xs text-gray-600">
          <p class="break-all leading-snug" v-if="coverMode === 'url'">{{ form.coverImage }}</p>
          <p v-else-if="uploadedFileName" class="font-medium">{{ uploadedFileName }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a
            v-if="isRemotePreview"
            :href="currentPreview"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center justify-center rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900"
          >
            Открыть
          </a>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:text-red-700"
            @click="clearCover"
          >
            Очистить
          </button>
        </div>
      </div>

      <div v-if="coverMode === 'url'" class="space-y-2">
        <input
          v-model="form.coverImage"
          type="text"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-brand-dark/40 focus:ring-1 focus:ring-brand-dark/40"
          placeholder="https://example.com/subcategory-cover.jpg"
        />
      </div>

      <div v-else class="space-y-2">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="handleFileSelected"
        />
        <div
          class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-xs text-gray-500 transition hover:border-brand-dark/50 hover:bg-white"
          @click="triggerFileSelect"
          @dragover.prevent
          @drop.prevent="handleFileDrop"
        >
          <svg class="h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 15.75a4.5 4.5 0 013.75-4.43 5.25 5.25 0 0110.5 0 4.5 4.5 0 013.75 4.43A3.75 3.75 0 0117.25 19.5h-10.5A3.75 3.75 0 013 15.75z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5l3-3 3 3m-3-3v7.5" />
          </svg>
          <div class="space-y-1">
            <p class="font-medium text-gray-700">Перетащите изображение сюда или выберите файл</p>
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark/90"
          >
            Выбрать файл
          </button>
        </div>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-2">Родительская линейка</label>
      <select
        v-model="form.parentId"
        class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-brand-dark focus:border-transparent text-sm"
      >
        <option value="">(Нет родителя)</option>
        <option
          v-for="option in parentOptions"
          :key="option.id"
          :value="option.id"
        >
          {{ option.label }}
        </option>
      </select>
      <p class="mt-1 text-xs text-gray-500">Выберите линейку, внутри которой будет располагаться текущая.</p>
    </div>

    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-gray-700">Скрывать пустую линейку</p>
        <p class="text-xs text-gray-500 mt-1">Если нет товаров, линейка не будет показана на витрине</p>
      </div>
      <label class="inline-flex items-center">
        <input
          v-model="form.hideEmpty"
          type="checkbox"
          class="w-5 h-5 text-brand-dark border-gray-300 rounded"
        />
      </label>
    </div>

    <div class="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div>
        <p class="text-sm font-medium text-gray-800">Не требуется для этой линейки</p>
        <p class="mt-0.5 text-xs text-gray-600">
          Снимет линейку из плашки «Нужно дозаполнить» по выбранным полям.
        </p>
      </div>
      <label class="flex items-start gap-2 text-sm text-gray-700">
        <input
          v-model="form.waiveDescription"
          type="checkbox"
          class="mt-0.5 rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
        />
        <span>Описание / крепость не требуется</span>
      </label>
      <label class="flex items-start gap-2 text-sm text-gray-700">
        <input
          v-model="form.waiveMinStock"
          type="checkbox"
          class="mt-0.5 rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
        />
        <span>Минимальный остаток не требуется</span>
      </label>
      <label class="flex items-start gap-2 text-sm text-gray-700">
        <input
          v-model="form.waiveWholesale"
          type="checkbox"
          class="mt-0.5 rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
        />
        <span>Оптовые цены не требуются</span>
      </label>
      <label v-if="showStrengthTier" class="flex items-start gap-2 text-sm text-gray-700">
        <input
          v-model="form.waiveStrengthTier"
          type="checkbox"
          class="mt-0.5 rounded border-gray-300 text-brand-dark focus:ring-brand-dark/30"
        />
        <span>Крепость для фильтра не требуется</span>
      </label>
    </div>

    <div class="flex justify-end gap-3 pt-2">
      <button
        type="button"
        class="px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors"
        @click="$emit('cancel')"
      >
        Отмена
      </button>
      <button
        type="submit"
        :disabled="isSubmitting"
        class="px-4 py-2 bg-brand-dark text-white rounded-lg hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {{ isSubmitting ? 'Сохранение...' : (editingGroup ? 'Сохранить изменения' : 'Создать линейку') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'

/** Срок плашки по умолчанию, столько же стоит на сервере. */
/** Цена скидки: пустое поле и мусор означают «скидки нет». */
function parseDiscountPrice(value: string): number | null {
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const DEFAULT_NEW_DAYS = 30
const MAX_NEW_DAYS = 180

function parseNewDays(value: string): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_NEW_DAYS
  return Math.min(parsed, MAX_NEW_DAYS)
}

interface CategoryGroup {
  id?: string
  name: string
  coverImage?: string | null
  hideEmpty?: boolean
  parentId?: string | null
  metaLabel?: string | null
  metaValue?: string | null
  minStockThreshold?: number | null
  totalControl?: boolean
  isNew?: boolean
  newDaysTotal?: number | null
  newDaysLeft?: number | null
  newSince?: string | null
  discount?: { price: number; untilDate: string | null; active: boolean } | null
  waiveDescription?: boolean
  waiveMinStock?: boolean
  waiveWholesale?: boolean
  waiveStrengthTier?: boolean
  strengthTier?: string | null
  depth?: number
  averageCostAuto?: number | null
  directProductCount?: number
  productsWithCostCount?: number
  wholesalePrices?: Record<string, number | null>
  wholesaleTiers?: WholesaleTier[]
}

interface WholesaleTier {
  id: string
  code: string
  label: string
  minOrderAmount: number
  sortOrder?: number
}

const props = withDefaults(defineProps<{ editingGroup?: CategoryGroup | null; isSubmitting?: boolean; availableGroups?: Array<CategoryGroup & { depth?: number }>; wholesaleTiers?: WholesaleTier[]; showStrengthTier?: boolean }>(), {
  editingGroup: null,
  isSubmitting: false,
  availableGroups: () => [],
  wholesaleTiers: () => [],
  showStrengthTier: false,
})

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; coverImage?: string | null; hideEmpty?: boolean; parentId?: string | null; metaLabel?: string | null; metaValue?: string | null; minStockThreshold?: number | null; totalControl?: boolean; isNew?: boolean; newDays?: number; discount?: { price: number | null; untilDate: string | null }; wholesalePrices?: Record<string, number | null>; waiveDescription?: boolean; waiveMinStock?: boolean; waiveWholesale?: boolean; waiveStrengthTier?: boolean; strengthTier?: string | null }): void
  (e: 'cancel'): void
}>()

const form = reactive({
  name: '',
  coverImage: '',
  hideEmpty: false,
  parentId: '',
  metaValue: '',
  minStockThreshold: '',
  totalControl: false,
  isNew: false,
  newDays: '30',
  discountEnabled: false,
  discountPrice: '',
  discountUntil: '',
  waiveDescription: false,
  waiveMinStock: false,
  waiveWholesale: false,
  waiveStrengthTier: false,
  strengthTier: '',
})

const strengthOptions = [
  { value: 'very_strong', label: 'Очень крепкая' },
  { value: 'strong', label: 'Крепкая' },
  { value: 'light', label: 'Легкая' },
]

const nameError = ref('')
const coverMode = ref<'url' | 'file'>('url')
const uploadPreview = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadedFileName = ref('')
const wholesalePriceInputs = reactive<Record<string, string>>({})

const defaultWholesaleTiers: WholesaleTier[] = [
  { id: 'wt_100', code: '100', label: 'Опт от 100 BYN', minOrderAmount: 100, sortOrder: 100 },
  { id: 'wt_250', code: '250', label: 'Опт от 250 BYN', minOrderAmount: 250, sortOrder: 250 },
  { id: 'wt_500', code: '500', label: 'Опт от 500 BYN', minOrderAmount: 500, sortOrder: 500 },
  { id: 'wt_1000', code: '1000', label: 'Опт от 1000 BYN', minOrderAmount: 1000, sortOrder: 1000 }
]

const resolvedWholesaleTiers = computed(() => {
  if (props.wholesaleTiers?.length) {
    return props.wholesaleTiers
  }

  if (props.editingGroup?.wholesaleTiers?.length) {
    return props.editingGroup.wholesaleTiers
  }

  const fromAvailableGroup = (props.availableGroups || []).find((group) => group.wholesaleTiers?.length)
  return fromAvailableGroup?.wholesaleTiers?.length ? fromAvailableGroup.wholesaleTiers : defaultWholesaleTiers
})

const averageCostAutoLabel = computed(() => {
  const value = props.editingGroup?.averageCostAuto
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'Появится после добавления товаров'
  }
  return `${Number(value).toFixed(2)} BYN`
})

const wholesaleFilledCount = computed(() =>
  resolvedWholesaleTiers.value.reduce((total, tier) => {
    const raw = String(wholesalePriceInputs[tier.code] ?? '').trim()
    return raw ? total + 1 : total
  }, 0),
)

const wholesaleTierKey = computed(() =>
  resolvedWholesaleTiers.value.map((tier) => `${tier.id}:${tier.code}`).join('|'),
)

function syncWholesalePriceInputs(group?: CategoryGroup | null) {
  Object.keys(wholesalePriceInputs).forEach((key) => {
    delete wholesalePriceInputs[key]
  })

  resolvedWholesaleTiers.value.forEach((tier) => {
    const rawValue = group?.wholesalePrices?.[tier.code]
    wholesalePriceInputs[tier.code] =
      rawValue === null || rawValue === undefined || Number.isNaN(Number(rawValue))
        ? ''
        : String(rawValue)
  })
}

watch(
  [() => props.editingGroup, wholesaleTierKey],
  ([group]) => {
    if (group) {
      form.name = group.name || ''
      form.coverImage = group.coverImage || ''
      form.hideEmpty = !!group.hideEmpty
      form.parentId = group.parentId || ''
      const label = (group.metaLabel || '').trim()
      const value = (group.metaValue || '').trim()
      form.metaValue = label && value ? `${label} ${value}` : (label || value)
      const threshold = group.minStockThreshold
      form.minStockThreshold =
        threshold === null || threshold === undefined || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0
          ? ''
          : String(threshold)
      form.totalControl = Boolean(group.totalControl)
      form.isNew = Boolean(group.isNew)
      form.discountEnabled = Boolean(group.discount)
      form.discountPrice = group.discount ? String(group.discount.price) : ''
      form.discountUntil = group.discount?.untilDate ?? ''
      form.newDays = String(group.newDaysTotal && group.newDaysTotal > 0 ? group.newDaysTotal : DEFAULT_NEW_DAYS)
      form.waiveDescription = Boolean(group.waiveDescription)
      form.waiveMinStock = Boolean(group.waiveMinStock)
      form.waiveWholesale = Boolean(group.waiveWholesale)
      form.waiveStrengthTier = Boolean(group.waiveStrengthTier)
      form.strengthTier = group.strengthTier || ''
      syncWholesalePriceInputs(group)
      if ((group.coverImage || '').startsWith('data:')) {
        coverMode.value = 'file'
        uploadPreview.value = group.coverImage || ''
      } else {
        coverMode.value = 'url'
        uploadPreview.value = ''
      }
      uploadedFileName.value = ''
    } else {
      form.name = ''
      form.coverImage = ''
      form.hideEmpty = false
      form.parentId = ''
      form.metaValue = ''
      form.minStockThreshold = ''
      form.totalControl = false
      form.isNew = false
      form.newDays = String(DEFAULT_NEW_DAYS)
      form.discountEnabled = false
      form.discountPrice = ''
      form.discountUntil = ''
      form.waiveDescription = false
      form.waiveMinStock = false
      form.waiveWholesale = false
      form.waiveStrengthTier = false
      form.strengthTier = ''
      syncWholesalePriceInputs(null)
      coverMode.value = 'url'
      uploadPreview.value = ''
      uploadedFileName.value = ''
    }
    nameError.value = ''
  },
  { immediate: true }
)

/** Сколько ещё висит плашка: число приходит с сервера, дату не парсим. */
/** Подсказка про обычную цену: менеджеру надо видеть, от чего он отнимает. */
const basePriceLabel = computed(() => {
  const current = props.editingGroup?.discount
  if (!current) return ''
  return current.active
    ? `Сейчас продаётся по ${current.price} BYN`
    : `Прошлая скидка ${current.price} BYN уже не действует`
})

/**
 * Дата из базы приходит как «2026-07-20 10:00:00», через пробел. Chrome такую
 * строку разбирает, Safari отдаёт Invalid Date — и подсказка молча исчезает у
 * менеджера на маке или айпаде. Приводим к виду с T, который понимают все.
 */
function parseServerDate(value: string): Date | null {
  const normalized = String(value).trim().replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * До какого числа будет гореть плашка, если сохранить форму как есть.
 *
 * Отсчёт повторяет серверный: у линейки, уже отмеченной новинкой, срок идёт от
 * даты, когда её отметили, а не от сегодня. Иначе каждое сохранение карточки
 * продлевало бы показ, и менеджер видел бы одну дату, а получал другую.
 */
const newUntilLabel = computed(() => {
  if (!form.isNew) return ''
  const days = Number(form.newDays)
  if (!Number.isFinite(days) || days < 1 || days > 180) return ''

  const startedAt = props.editingGroup?.isNew ? props.editingGroup.newSince : null
  const start = startedAt ? parseServerDate(startedAt) : new Date()
  if (!start || Number.isNaN(start.getTime())) return ''

  const until = new Date(start)
  until.setDate(until.getDate() + days)
  return `С учётом срока плашка будет гореть до ${until.toLocaleDateString('ru-RU')}`
})

const newDaysLeftLabel = computed(() => {
  if (!props.editingGroup?.isNew) return ''
  const left = Number(props.editingGroup.newDaysLeft ?? 0)
  if (!Number.isFinite(left) || left <= 0) return 'Сегодня последний день показа'
  return `Сейчас плашка горит ещё ${left} ${pluralDays(left)}`
})

function pluralDays(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'дней'
  if (mod10 === 1) return 'день'
  if (mod10 >= 2 && mod10 <= 4) return 'дня'
  return 'дней'
}

const isValid = computed(() => {
  const trimmed = form.name.trim()
  if (!trimmed) {
    nameError.value = 'Название обязательно'
    return false
  }
  if (trimmed.length > 120) {
    nameError.value = 'Название должно быть короче 120 символов'
    return false
  }
  nameError.value = ''
  return true
})

function onSubmit() {
  if (!isValid.value || props.isSubmitting) {
    return
  }
  const metaValue = form.metaValue.trim()
  const wholesalePrices = Object.fromEntries(
    resolvedWholesaleTiers.value.map((tier) => {
      const rawSource = wholesalePriceInputs[tier.code]
      const rawValue = String(rawSource ?? '').trim()
      if (!rawValue) {
        return [tier.code, null]
      }

      const numeric = Number(rawValue)
      return [tier.code, Number.isFinite(numeric) && numeric > 0 ? numeric : null]
    }),
  )
  const rawThreshold = String(form.minStockThreshold ?? '').trim()
  let minStockThreshold: number | null = null
  if (rawThreshold) {
    const parsed = Number(rawThreshold)
    if (Number.isFinite(parsed) && parsed > 0) {
      minStockThreshold = Math.floor(parsed)
    }
  }
  emit('submit', {
    name: form.name.trim(),
    coverImage: form.coverImage.trim() ? form.coverImage.trim() : null,
    hideEmpty: form.hideEmpty,
    parentId: form.parentId ? form.parentId : null,
    metaLabel: null,
    metaValue: metaValue.length ? metaValue : null,
    minStockThreshold,
    totalControl: form.totalControl,
    isNew: form.isNew,
    discount: form.discountEnabled
      ? { price: parseDiscountPrice(form.discountPrice), untilDate: form.discountUntil || null }
      : { price: null, untilDate: null },
    // Срок уходит только вместе с включённой галкой: сервер сам решает,
    // продлить текущую новинку или начать отсчёт заново.
    ...(form.isNew ? { newDays: parseNewDays(form.newDays) } : {}),
    wholesalePrices,
    waiveDescription: form.waiveDescription,
    waiveMinStock: form.waiveMinStock,
    waiveWholesale: form.waiveWholesale,
    waiveStrengthTier: form.waiveStrengthTier,
    strengthTier: form.strengthTier ? form.strengthTier : null,
  })
}

const currentPreview = computed(() => {
  if (coverMode.value === 'file') {
    return uploadPreview.value
  }
  return form.coverImage.trim()
})

const hasPreview = computed(() => Boolean(currentPreview.value))
const isRemotePreview = computed(() => /^https?:\/\//i.test(currentPreview.value || ''))

function setCoverMode(mode: 'url' | 'file') {
  coverMode.value = mode
  if (mode === 'url' && form.coverImage.startsWith('data:')) {
    form.coverImage = ''
  }
  if (mode === 'url') {
    uploadPreview.value = ''
    uploadedFileName.value = ''
  }
}

function triggerFileSelect() {
  fileInputRef.value?.click()
}

function handleFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files || !target.files.length) return
  processFile(target.files[0])
}

function handleFileDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  processFile(file)
}

function processFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return
  }
  coverMode.value = 'file'
  uploadedFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    uploadPreview.value = result
    form.coverImage = result
  }
  reader.readAsDataURL(file)
}

function clearCover() {
  uploadPreview.value = ''
  uploadedFileName.value = ''
  form.coverImage = ''
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  if (coverMode.value === 'file') {
    coverMode.value = 'url'
  }
}

function formatTierMinAmount(value: number) {
  return Number(value || 0).toFixed(0)
}

const blockedParentIds = computed(() => {
  const blocked = new Set<string>()
  const sourceId = props.editingGroup?.id
  if (!sourceId) {
    return blocked
  }
  blocked.add(sourceId)
  const queue: string[] = [sourceId]
  while (queue.length) {
    const current = queue.shift()!
    for (const group of props.availableGroups || []) {
      if (!group.id || blocked.has(group.id)) continue
      if ((group.parentId || null) === current) {
        blocked.add(group.id)
        queue.push(group.id)
      }
    }
  }
  return blocked
})

const parentOptions = computed(() => {
  return (props.availableGroups || [])
    .filter(group => {
      const id = group.id || ''
      if (!id) return false
      if (blockedParentIds.value.has(id)) return false
      if (props.editingGroup && id === props.editingGroup.id) return false
      return true
    })
    .map(group => ({
      id: group.id || '',
      label: `${'· '.repeat(group.depth ?? 0)}${group.name}`.trim()
    }))
})

watch(
  () => props.availableGroups,
  (list) => {
    if (!form.parentId) return
    const exists = (list || []).some(group => group.id === form.parentId)
    if (!exists || blockedParentIds.value.has(form.parentId)) {
      form.parentId = ''
    }
  }
)
</script>
