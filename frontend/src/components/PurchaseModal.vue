<template>
  <AdminModal
    :is-open="props.isOpen"
    title="Оформить заказ"
    :show-actions="false"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <!-- Product summary -->
      <div v-if="product" class="flex items-center space-x-3 p-2.5 bg-gray-50 rounded-lg">
        <img
          :src="productImage"
          :alt="product.title || 'Товар'"
          class="w-11 h-14 object-cover rounded-md"
        />
        <div class="flex-1">
          <h3 class="font-display text-sm font-normal text-brand-dark leading-tight">{{ product.title }}</h3>
          <p class="font-primary text-base font-bold text-brand-primary mt-0.5 tabular-nums">{{ formatPrice(product.priceRub) }}</p>
        </div>
      </div>

      <!-- Instructions -->
      <div class="text-center">
        <div class="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center mx-auto mb-2">
          <ShoppingBagIcon class="w-5 h-5 text-brand-dark" />
        </div>
        <h3 class="font-display text-base font-medium text-brand-dark mb-2 uppercase tracking-wide">
          Как оформить заказ:
        </h3>
        <div class="font-primary text-sm text-gray-700 leading-relaxed">
          Нажмите кнопку ниже<br>
          Откроется чат с готовым сообщением<br>
          Отправьте сообщение менеджеру
        </div>
      </div>
      
      <!-- Actions -->
      <div class="space-y-3 flex flex-col items-center">
        <!-- Main order button - ОСНОВНАЯ КНОПКА ДЛЯ ЗАКАЗА -->
        <a
          :href="managerLinkWithMessage"
          class="inline-flex items-center justify-center space-x-2 w-full py-3.5 bg-brand-primary text-brand-dark rounded-xl font-bold text-base tracking-wide shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 text-decoration-none"
          style="font-family: var(--font-primary); text-decoration: none; font-size: 1.1rem;"
          target="_blank"
          rel="noopener"
          @click="onOrderClick"
        >
          <ShoppingBagIcon class="w-5 h-5" />
          <span>Написать менеджеру</span>
        </a>
        
        <!-- Close button -->
        <button
          ref="closeButton"
          class="w-full px-4 py-2 bg-transparent text-brand-dark border-2 border-brand-dark rounded-xl font-medium uppercase tracking-wider transition-all duration-300 hover:bg-brand-dark hover:text-white focus:outline-none active:scale-95"
          style="font-family: var(--font-primary); font-size: 13px;"
          @click="handleClose"
          @mousedown="onCloseMouseDown"
          @mouseup="onCloseMouseUp"
          @mouseleave="onCloseMouseUp"
        >
          Закрыть
        </button>
      </div>
    </div>
  </AdminModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminModal from '@/components/AdminModal.vue'
import { useSettingsStore } from '@/stores/settings'
import {
  ShoppingBagIcon
} from '@heroicons/vue/24/outline'

interface ProductLink { label?: string; url: string }

interface Product {
  id: string | number
  title?: string
  priceRub: number
  images?: string[]
  links?: ProductLink[]
}

interface Props {
  isOpen: boolean
  product: Product | null
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const router = useRouter()
const settingsStore = useSettingsStore()

// Refs
const closeButton = ref<HTMLButtonElement>()
const isClosing = ref(false)

const product = computed(() => props.product)

const productImage = computed(() => {
  const p = props.product
  if (!p) {
    return 'https://placehold.co/45x55/383b3d/ffc81a?text=TOVAR'
  }

  const fromImages = p.images?.find(src => typeof src === 'string' && src.trim().length > 0)
  if (fromImages) {
    return fromImages
  }

  const fromLinks = p.links?.find(link => typeof link?.url === 'string' && link.url.trim().length > 0)?.url
  return fromLinks || `https://placehold.co/45x55/383b3d/ffc81a?text=${encodeURIComponent(p.title || 'Товар')}`
})

const productUrl = computed(() => {
  if (!props.product) return ''
  const resolved = router.resolve({ path: `/p/${props.product.id}` })
  const origin = window?.location?.origin || ''
  return origin ? new URL(resolved.href, origin).toString() : resolved.href
})

const orderMessage = computed(() => {
  if (!props.product) return ''
  const title = props.product.title || 'Товар'
  const price = formatPrice(props.product.priceRub)
  const url = productUrl.value
  
  return `Хочу купить: ${title}\nЦена: ${price}\nСсылка: ${url}`
})

const managerLinkWithMessage = computed(() => {
  const encodedMessage = encodeURIComponent(orderMessage.value)
  const telegram = settingsStore.settings.manager_telegram
  return `https://t.me/${telegram}?text=${encodedMessage}`
})


function formatPrice(price: number): string {
  return `${price.toLocaleString('ru-RU')} BYN`
}

function onOrderClick() {
  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.HapticFeedback.impactOccurred('medium')
    // Пытаемся открыть через Telegram Web App API, если доступно
    if (window.Telegram.WebApp.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(managerLinkWithMessage.value)
      return
    }
  }
  // Обычное открытие ссылки как fallback
}

// Крутые эффекты для кнопки закрытия
function onCloseMouseDown() {
  if (closeButton.value) {
    closeButton.value.style.backgroundColor = '#383b3d'
    closeButton.value.style.color = '#ffffff'
    closeButton.value.style.borderColor = '#383b3d'
  }
}

function onCloseMouseUp() {
  if (closeButton.value && !isClosing.value) {
    closeButton.value.style.backgroundColor = 'transparent'
    closeButton.value.style.color = '#383b3d'
    closeButton.value.style.borderColor = '#383b3d'
  }
}

function handleClose() {
  isClosing.value = true
  
  // Крутой эффект - кнопка становится белой
  if (closeButton.value) {
    closeButton.value.style.transition = 'all 0.4s ease-out'
    closeButton.value.style.backgroundColor = '#ffffff'
    closeButton.value.style.color = '#383b3d'
    closeButton.value.style.borderColor = '#ffffff'
    closeButton.value.style.boxShadow = '0 4px 16px rgba(255,255,255,0.3)'
    closeButton.value.style.transform = 'scale(0.95)'
  }
  
  // Задержка для эффекта, затем закрываем
  setTimeout(() => {
    emit('close')
    // Сброс состояния через некоторое время
    setTimeout(() => {
      isClosing.value = false
      if (closeButton.value) {
        closeButton.value.style.cssText = ''
      }
    }, 500)
  }, 150)
}

// Загружаем настройки при монтировании компонента
onMounted(() => {
  settingsStore.fetchSettings()
})


</script>
