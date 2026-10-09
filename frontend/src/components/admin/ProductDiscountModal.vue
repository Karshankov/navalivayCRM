<template>
  <!--
    Быстрая скидка прямо из списка товаров. Полная форма товара тоже умеет её
    ставить, но когда надо пройтись по нескольким позициям подряд, открывать
    её каждый раз долго.
  -->
  <AdminModal
    :is-open="isOpen"
    title="Скидка на товар"
    :description="product?.title || ''"
    size="sm"
    :show-actions="false"
    @close="$emit('close')"
    @cancel="$emit('close')"
  >
    <div class="space-y-4">
      <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        Обычная цена: <span class="font-semibold">{{ basePriceLabel }}</span>
      </div>

      <label class="block">
        <span class="mb-1 block text-sm font-medium text-gray-700">Цена со скидкой, BYN</span>
        <input
          ref="priceInput"
          v-model="price"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-rose-500/30"
          placeholder="Например 30"
        />
        <span v-if="percentLabel" class="mt-1 block text-xs text-gray-500">{{ percentLabel }}</span>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm font-medium text-gray-700">Действует по</span>
        <input
          v-model="untilDate"
          type="date"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-rose-500/30"
        />
        <span class="mt-1 block text-xs text-gray-500">
          {{ untilDate ? 'В этот день скидка ещё работает, дальше цена вернётся сама.' : 'Без даты скидка держится, пока её не снимут.' }}
        </span>
      </label>

      <p class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Бонусы за покупку со скидкой не начисляются и не списываются.
      </p>

      <p v-if="errorMessage" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ errorMessage }}
      </p>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <button
          v-if="hasExistingDiscount"
          type="button"
          class="min-h-[44px] rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          :disabled="saving"
          @click="clearDiscount"
        >
          Снять скидку
        </button>
        <div class="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
          <button
            type="button"
            class="min-h-[44px] rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            :disabled="saving"
            @click="$emit('close')"
          >
            Отмена
          </button>
          <button
            type="button"
            class="min-h-[44px] rounded-xl bg-rose-600 px-5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40"
            :disabled="saving || !price"
            @click="save"
          >
            {{ saving ? 'Сохраняем…' : 'Поставить скидку' }}
          </button>
        </div>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AdminModal from '@/components/AdminModal.vue'
import { useAdminStore } from '@/stores/admin'

interface DiscountProduct {
  id: string
  title?: string
  priceRub?: number
  discount?: { price: number; untilDate: string | null; active: boolean } | null
}

const props = defineProps<{ isOpen: boolean; product: DiscountProduct | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const adminStore = useAdminStore()
const price = ref('')
const untilDate = ref('')
const saving = ref(false)
const errorMessage = ref('')

const hasExistingDiscount = computed(() => Boolean(props.product?.discount))
const basePriceLabel = computed(() => {
  const base = Number(props.product?.priceRub ?? 0)
  return base > 0 ? `${base} BYN` : 'не указана'
})

const percentLabel = computed(() => {
  const base = Number(props.product?.priceRub ?? 0)
  const next = Number(String(price.value).replace(',', '.'))
  if (!Number.isFinite(next) || next <= 0 || base <= 0 || next >= base) return ''
  return `Это скидка ${Math.round(((base - next) / base) * 100)}%`
})

watch(
  () => [props.isOpen, props.product?.id],
  () => {
    if (!props.isOpen) return
    price.value = props.product?.discount ? String(props.product.discount.price) : ''
    untilDate.value = props.product?.discount?.untilDate ?? ''
    errorMessage.value = ''
  },
  { immediate: true },
)

async function submit(discount: { price: number | null; untilDate: string | null }) {
  if (!props.product?.id || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await adminStore.updateProduct(props.product.id, { discount } as never)
    emit('saved')
    emit('close')
  } catch (error: any) {
    const code = String(error?.data?.error || '')
    errorMessage.value = code === 'invalid_discount_price'
      ? 'Цена должна быть числом не меньше нуля.'
      : code === 'invalid_discount_date'
        ? 'Дата не распознана. Выберите её в календаре.'
        : 'Не удалось сохранить скидку. Попробуйте ещё раз.'
  } finally {
    saving.value = false
  }
}

function save() {
  const parsed = Number(String(price.value).replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) {
    errorMessage.value = 'Введите цену со скидкой.'
    return
  }
  void submit({ price: parsed, untilDate: untilDate.value || null })
}

function clearDiscount() {
  void submit({ price: null, untilDate: null })
}
</script>
