<template>
  <div class="product-page min-h-screen bg-white">
    <!-- Loading State -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="loading" class="fixed inset-0 bg-white z-50 flex items-center justify-center">
        <div class="text-center">
          <div class="relative w-20 h-20 mx-auto mb-4">
            <div class="absolute inset-0 border-4 border-brand-primary/20 rounded-full"></div>
            <div class="absolute inset-0 border-4 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p class="text-brand-dark font-medium animate-pulse">Загружаем товар...</p>
        </div>
      </div>
    </Transition>

    <!-- Error State -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div v-if="!loading && error" class="flex flex-col items-center justify-center min-h-screen px-6">
        <div class="text-center">
          <div class="w-24 h-24 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
            <ExclamationTriangleIcon class="w-12 h-12 text-red-500" />
          </div>
          <h2 class="text-2xl font-semibold text-brand-dark mb-2">Упс! Товар не найден</h2>
          <p class="text-gray-600 mb-8 max-w-md mx-auto">{{ error }}</p>
          <div class="flex flex-col sm:flex-row gap-3 justify-center">
            <button 
              @click="$router.back()"
              class="px-6 py-3 bg-white text-brand-dark border-2 border-brand-dark rounded-xl font-semibold hover:bg-gray-50 transition-all"
            >
              Назад
            </button>
            <router-link 
              to="/"
              class="px-6 py-3 bg-brand-primary text-brand-dark rounded-xl font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              На главную
            </router-link>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Product Content -->
    <Transition
      enter-active-class="transition-all duration-500"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      appear
    >
      <div v-if="!loading && product" class="relative">
        <!-- Mobile Layout (unchanged) -->
        <div class="lg:hidden">
          <!-- Product Hero Gallery -->
          <ProductHero
            :images="images"
            :product-title="product.title"
            :badges="productBadges"
            :external-current-slide="currentSlide"
            @slide-change="currentSlide = $event"
          />

          <!-- Variants Selector Mobile -->
          <div v-if="hasVariants && availableVariants.length" class="px-4 py-4 bg-white border-b border-gray-100">
            <h3 class="text-sm font-medium text-gray-700 mb-3">Выберите цвет: {{ selectedVariant?.name }}</h3>
            <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <button
                v-for="variant in availableVariants"
                :key="variant.id"
                @click="selectVariant(variant.id!)"
                class="relative flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all"
                :class="[
                  selectedVariant?.id === variant.id
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 active:border-gray-300'
                ]"
              >
                <!-- Color image or color code circle -->
                <div
                  v-if="variant.colorImage"
                  class="w-12 h-12 rounded-full border-2 border-white shadow-md overflow-hidden"
                >
                  <img 
                    :src="variant.colorImage" 
                    :alt="variant.name"
                    class="w-full h-full object-cover"
                  />
                </div>
                <div
                  v-else
                  class="w-12 h-12 rounded-full border-2 border-white shadow-md"
                  :style="{ backgroundColor: variant.colorCode || '#9ca3af' }"
                ></div>
                <span class="text-xs font-medium text-gray-700 whitespace-nowrap">{{ variant.name }}</span>
                <div v-if="selectedVariant?.id === variant.id" class="absolute -top-1 -right-1 w-5 h-5 bg-brand-primary rounded-full flex items-center justify-center">
                  <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </div>
              </button>
            </div>
          </div>

          <!-- Product Information Tabs -->
          <ProductInfo
            :product="product"
            :category="category"
          />

          <!-- Spacer for bottom bar -->
          <div :style="{ height: bottomBarHeight + 'px' }"></div>
        </div>

        <!-- Desktop Layout -->
        <div class="hidden lg:block">
          <!-- Desktop Header with Back Button -->
          <div class="container mx-auto px-8 py-6 max-w-7xl">
            <div class="flex items-center gap-4 mb-8">
              <button
                @click="router.back()"
                class="w-12 h-12 bg-white border border-gray-200 rounded-xl flex items-center justify-center shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                aria-label="Назад"
              >
                <ChevronLeftIcon class="w-6 h-6 text-brand-dark" />
              </button>
              <nav class="text-sm text-gray-600">
                <router-link to="/" class="hover:text-brand-primary transition-colors">Главная</router-link>
                <span class="mx-2">/</span>
                <router-link 
                  v-if="category" 
                  :to="`/category/${category.slug}`" 
                  class="hover:text-brand-primary transition-colors"
                >
                  {{ category.name }}
                </router-link>
                <template v-if="category && productGroupRoute">
                  <span class="mx-2">/</span>
                  <router-link
                    :to="productGroupRoute"
                    class="hover:text-brand-primary transition-colors"
                  >
                    {{ product?.groupName }}
                  </router-link>
                </template>
                <span v-if="category || productGroupRoute" class="mx-2">/</span>
                <span class="text-brand-dark font-medium">{{ product.title }}</span>
              </nav>
            </div>
          </div>

          <!-- Desktop Product Content -->
          <div class="container mx-auto px-8 pb-16 max-w-7xl">
            <div class="grid grid-cols-12 gap-12">
              <!-- Left Column - Images (7 columns) -->
              <div class="col-span-7">
                <div class="sticky top-8">
                  <!-- Main Image -->
                  <div class="relative mb-6 bg-gradient-to-b from-gray-50 to-white rounded-2xl overflow-hidden shadow-sm">
                    <div class="aspect-square w-full relative">
                      <!-- Badges -->
                      <div 
                        v-if="productBadges.length > 0"
                        class="absolute top-6 left-6 flex flex-col gap-3 z-10"
                      >
                        <TransitionGroup
                          enter-active-class="transition-all duration-500"
                          enter-from-class="opacity-0 -translate-x-4"
                          enter-to-class="opacity-100 translate-x-0"
                        >
                          <div
                            v-for="(badge, idx) in productBadges"
                            :key="`badge-${badge.type}`"
                            class="inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-md"
                            :class="getBadgeClass(badge.type)"
                            :style="{ transitionDelay: `${idx * 100}ms` }"
                          >
                            <component :is="getBadgeIcon(badge.type)" class="w-4 h-4" />
                            <span class="text-sm font-bold uppercase tracking-wider">{{ badge.text }}</span>
                          </div>
                        </TransitionGroup>
                      </div>

                      <!-- Current Image -->
                      <img
                        :src="images[currentSlide]"
                        :alt="`${product.title} - Фото ${currentSlide + 1}`"
                        class="w-full h-full object-cover cursor-pointer transition-transform duration-300 hover:scale-105"
                        @click="openDesktopLightbox"
                        loading="eager"
                      />
                    </div>
                  </div>

                  <!-- Thumbnails -->
                  <div v-if="images.length > 1" class="grid grid-cols-6 gap-3">
                    <button
                      v-for="(image, idx) in images"
                      :key="`desktop-thumb-${idx}`"
                      @click="currentSlide = idx"
                      class="relative aspect-square rounded-xl overflow-hidden transition-all duration-300 focus:outline-none"
                      :class="[
                        idx === currentSlide 
                          ? 'ring-2 ring-brand-primary scale-105' 
                          : 'ring-1 ring-gray-200 hover:ring-brand-primary/50 hover:scale-102'
                      ]"
                    >
                      <img
                        :src="image"
                        :alt="`Миниатюра ${idx + 1}`"
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <!-- Active Overlay -->
                      <div
                        v-if="idx === currentSlide"
                        class="absolute inset-0 bg-brand-primary/10"
                      />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right Column - Product Info (5 columns) -->
              <div class="col-span-5">
                <div class="sticky top-8">
                  <!-- Product Title -->
                  <h1 class="text-4xl font-display font-medium text-brand-dark mb-4 leading-tight">
                    {{ product.title }}
                  </h1>

                  <!-- Category -->
                  <div class="mb-6 flex flex-wrap items-center gap-2">
                    <router-link
                      v-if="category"
                      :to="`/category/${category.slug}`"
                      class="inline-flex items-center gap-2 text-gray-600 hover:text-brand-primary transition-colors font-medium"
                    >
                      <TagIcon class="w-5 h-5" />
                      <span>{{ category.name }}</span>
                    </router-link>
                    <router-link
                      v-if="productGroupRoute"
                      :to="productGroupRoute"
                      class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold bg-brand-primary/10 text-brand-dark border border-brand-primary/50 hover:bg-brand-primary/20 transition-colors"
                    >
                      <span>{{ product?.groupName }}</span>
                    </router-link>
                  </div>

                  <!-- Variants Selector -->
                  <div v-if="hasVariants && availableVariants.length" class="mb-6">
                    <h3 class="text-sm font-medium text-gray-700 mb-3">Выберите цвет: {{ selectedVariant?.name }}</h3>
                    <div class="flex flex-wrap gap-3">
                      <button
                        v-for="variant in availableVariants"
                        :key="variant.id"
                        @click="selectVariant(variant.id!)"
                        class="group relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all"
                        :class="[
                          selectedVariant?.id === variant.id
                            ? 'border-brand-primary bg-brand-primary/5'
                            : 'border-gray-200 hover:border-gray-300'
                        ]"
                      >
                        <!-- Color image or color code circle -->
                        <div
                          v-if="variant.colorImage"
                          class="w-12 h-12 rounded-full border-2 border-white shadow-md overflow-hidden"
                        >
                          <img 
                            :src="variant.colorImage" 
                            :alt="variant.name"
                            class="w-full h-full object-cover"
                          />
                        </div>
                        <div
                          v-else
                          class="w-12 h-12 rounded-full border-2 border-white shadow-md"
                          :style="{ backgroundColor: variant.colorCode || '#9ca3af' }"
                        ></div>
                        <span class="text-xs font-medium text-gray-700">{{ variant.name }}</span>
                        <div v-if="selectedVariant?.id === variant.id" class="absolute -top-1 -right-1 w-5 h-5 bg-brand-primary rounded-full flex items-center justify-center">
                          <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                          </svg>
                        </div>
                      </button>
                    </div>
                  </div>

                  <!-- Price -->
                  <div class="mb-8 p-6 bg-gray-50 rounded-2xl">
                    <div class="flex items-center justify-between mb-4">
                      <div>
                        <span v-if="currentOldPrice" class="mr-2 text-xl font-semibold text-gray-400 line-through tabular-nums">
                          {{ formatPrice(currentOldPrice) }}
                        </span>
                        <span class="text-4xl font-bold text-brand-dark tabular-nums">
                          {{ formatPrice(currentPrice) }}
                        </span>
                      </div>
                      <!-- Stock Status -->
                      <div class="flex items-center gap-2 px-4 py-2 rounded-full" :class="isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                        <CheckCircleIcon v-if="isAvailable" class="w-5 h-5" />
                        <span class="font-medium">{{ isAvailable ? 'В наличии' : 'Нет в наличии' }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Description -->
                  <div v-if="product.description" class="mb-8">
                    <h3 class="text-lg font-medium text-brand-dark mb-3">Описание</h3>
                    <p class="text-gray-700 leading-relaxed text-base">
                      {{ product.description }}
                    </p>
                  </div>

                  <!-- Action Buttons -->
                  <div class="space-y-3">
                    <button
                      @click="addToCart"
                      class="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-lg uppercase tracking-wide shadow-lg hover:shadow-xl hover:-translate-y-1 active:scale-98 transition-all duration-300"
                    >
                      <span class="flex items-center justify-center gap-3">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span>Добавить в корзину</span>
                      </span>
                    </button>
                    <button
                      @click="buyNow"
                      class="w-full py-4 bg-brand-primary text-brand-dark rounded-xl font-bold text-lg uppercase tracking-wide shadow-lg hover:shadow-xl hover:-translate-y-1 active:scale-98 transition-all duration-300"
                    >
                      <span class="flex items-center justify-center gap-3">
                        <ShoppingBagIcon class="w-6 h-6" />
                        <span>Купить сейчас</span>
                      </span>
                    </button>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Enhanced Bottom Action Bar - Mobile Only -->
    <Transition
      enter-active-class="transition-all duration-500"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-all duration-300"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div 
        v-if="!loading && product" 
        ref="bottomBarRef"
        class="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] z-30"
      >
        <div class="px-4 py-3">
          <!-- Price and Stock Info -->
          <div class="flex items-center justify-between" style="margin-bottom: 0.9rem;">
            <div>
              <div class="flex items-baseline gap-2">
                <span v-if="currentOldPrice" class="text-base font-semibold text-gray-400 line-through tabular-nums">
                  {{ formatPrice(currentOldPrice) }}
                </span>
                <span class="text-2xl font-bold text-brand-dark tabular-nums">
                  {{ formatPrice(currentPrice) }}
                </span>
              </div>
              <div v-if="hasVariants && selectedVariant" class="text-xs text-gray-600 mt-1">
                {{ selectedVariant.name }}
              </div>
            </div>

            <!-- Stock Status -->
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full" :class="isAvailable ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'">
              <CheckCircleIcon v-if="isAvailable" class="w-4 h-4" />
              <span class="text-sm font-medium">{{ isAvailable ? 'В наличии' : 'Нет' }}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="space-y-2">
            <button
              @click="addToCart"
              class="w-full py-3 bg-gray-900 text-white rounded-xl font-bold text-base uppercase tracking-wide shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              <span class="flex items-center justify-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>В корзину</span>
              </span>
            </button>
            <button
              @click="buyNow"
              class="w-full py-3 bg-brand-primary text-brand-dark rounded-xl font-bold text-base uppercase tracking-wide shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            >
              <span class="flex items-center justify-center gap-2">
                <ShoppingBagIcon class="w-5 h-5" />
                <span>Купить сейчас</span>
              </span>
            </button>
          </div>

        </div>

        <!-- Safe area for iOS -->
        <div class="h-safe-bottom"></div>
      </div>
    </Transition>

    <!-- Purchase Modal -->
    <PurchaseModal
      :is-open="showPurchaseModalState"
      :product="purchaseProduct"
      @close="showPurchaseModalState = false"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRouter, onBeforeRouteUpdate } from 'vue-router'
import { useCatalogStore } from '@/stores/catalog'
import { useCartStore } from '@/stores/cart'
import { useWholesaleStore } from '@/stores/wholesale'

// Import new components
import ProductHero from '@/components/product/ProductHero.vue'
import ProductInfo from '@/components/product/ProductInfo.vue'
import PurchaseModal from '@/components/PurchaseModal.vue'

// Icons
import { 
  ExclamationTriangleIcon,
  ShoppingBagIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  TagIcon,
  FireIcon,
  SparklesIcon,
  BoltIcon,
  ShieldCheckIcon
} from '@heroicons/vue/24/outline'

// Props and stores
const props = defineProps<{ id: string }>()
const catalogStore = useCatalogStore()
const cartStore = useCartStore()
const wholesaleStore = useWholesaleStore()
const router = useRouter()

// State
const loading = ref(false)
const error = ref('')
const currentSlide = ref(0)
const showPurchaseModalState = ref(false)
const purchaseProduct = ref<any>(null)
const bottomBarRef = ref<HTMLElement | null>(null)
const bottomBarHeight = ref(112) // Дефолтное значение h-28
const selectedVariantId = ref<string | null>(null)

// Computed properties
const product = computed(() => {
  const cp = catalogStore.currentProduct
  if (cp && cp.id === props.id) return cp
  return catalogStore.products.find(p => p.id === props.id) || null
})

const category = computed(() => {
  if (!product.value) return null
  return catalogStore.categories.find(cat => cat.id === product.value!.categoryId) || null
})

const productGroupRoute = computed(() => {
  if (!product.value?.groupSlug || !category.value?.slug) return null
  return {
    name: 'category',
    params: { slug: category.value.slug },
    query: { group: product.value.groupSlug }
  }
})

// Проверяем, есть ли у товара варианты
const hasVariants = computed(() => {
  return Boolean(product.value?.hasVariants && product.value?.variants && product.value.variants.length > 0)
})

// Только варианты в наличии (stock > 0)
const availableVariants = computed(() => {
  if (!product.value?.variants) return []
  return product.value.variants.filter(v => {
    if (v.isAvailable === false) return false
    if (typeof v.stock === 'number') return v.stock > 0
    return true // Если stock не указан, считаем что в наличии
  })
})

// Текущий выбранный вариант
const selectedVariant = computed(() => {
  if (!hasVariants.value || !availableVariants.value.length) return null
  return availableVariants.value.find(v => v.id === selectedVariantId.value) || availableVariants.value[0]
})

// Цена с учетом варианта
const currentPrice = computed(() => {
  if (hasVariants.value && selectedVariant.value?.priceRub) {
    return selectedVariant.value.priceRub
  }
  return product.value?.priceRub || 0
})

/** Цена до скидки для выбранного вкуса или самого товара. */
const currentOldPrice = computed(() => {
  const source = hasVariants.value && selectedVariant.value
    ? selectedVariant.value
    : product.value
  const oldPrice = Number(source?.oldPriceRub ?? 0)
  return source?.hasDiscount && oldPrice > currentPrice.value ? oldPrice : 0
})

// Доступность с учетом варианта
const isAvailable = computed(() => {
  if (hasVariants.value && selectedVariant.value) {
    return (selectedVariant.value.stock ?? 0) > 0
  }
  return product.value?.isAvailable ?? true
})

const images = computed(() => {
  if (!product.value) return [] as string[]

  const media: string[] = []
  
  // Если товар с вариантами, используем изображения выбранного варианта
  if (hasVariants.value && selectedVariant.value) {
    const variantImages = selectedVariant.value.images?.filter(src => typeof src === 'string' && src.trim().length > 0) ?? []
    media.push(...variantImages)
  } else {
    // Обычный товар - используем его изображения
    const fromImages = product.value.images?.filter(src => typeof src === 'string' && src.trim().length > 0) ?? []
    media.push(...fromImages)

    const fromLinks = product.value.links?.map(link => link?.url?.trim() || '')
      .filter(url => url.length > 0) ?? []
    media.push(...fromLinks)
  }

  return media
})

const productBadges = computed(() => {
  const badges: Array<{ type: 'new' | 'hot' | 'sale' | 'exclusive' | 'lastpiece', text: string }> = []
  // Remove isNew and isSale checks as they don't exist in Product interface
  // Add badges based on actual product properties if needed
  return badges
})


// Variant selection
function selectVariant(variantId: string) {
  selectedVariantId.value = variantId
  currentSlide.value = 0
  hapticFeedback('light')
}

// Actions
function addToCart() {
  if (!product.value) return

  // Для товаров с вариантами передаем выбранный вариант
  if (hasVariants.value && selectedVariant.value) {
    cartStore.addItem(product.value, 1, selectedVariant.value.id)
  } else {
    cartStore.addItem(product.value, 1)
  }
  
  hapticFeedback('success')
  
  // Show notification
  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.showAlert('Товар добавлен в корзину')
  }
}

function buyNow() {
  if (!product.value) return
  
  purchaseProduct.value = product.value
  showPurchaseModalState.value = true
  hapticFeedback('medium')
}

// Desktop lightbox
function openDesktopLightbox() {
  // For now, just cycle through images on click
  if (images.value.length > 1) {
    currentSlide.value = (currentSlide.value + 1) % images.value.length
  }
  hapticFeedback('light')
}

// Badge utilities for desktop
function getBadgeClass(type: string) {
  const classes = {
    new: 'bg-green-500/90 text-white',
    hot: 'bg-red-500/90 text-white', 
    sale: 'bg-brand-primary/90 text-brand-dark',
    exclusive: 'bg-purple-600/90 text-white',
    lastpiece: 'bg-orange-500/90 text-white'
  }
  return classes[type as keyof typeof classes] || 'bg-gray-600/90 text-white'
}

function getBadgeIcon(type: string) {
  const icons = {
    new: SparklesIcon,
    hot: FireIcon,
    sale: BoltIcon, 
    exclusive: ShieldCheckIcon,
    lastpiece: FireIcon
  }
  return icons[type as keyof typeof icons] || SparklesIcon
}



// Utilities
function formatPrice(price: number): string {
  return `${price.toLocaleString('ru-RU')} BYN`
}

function hapticFeedback(style: 'light' | 'medium' | 'heavy' | 'error' | 'success' = 'light') {
  if (window.Telegram?.WebApp?.HapticFeedback) {
    const impact = style === 'error' || style === 'success' ? 'heavy' : style as any
    window.Telegram.WebApp.HapticFeedback.impactOccurred(impact)
  }
}

// Обновление высоты нижней панели
function updateBottomBarHeight() {
  nextTick(() => {
    if (bottomBarRef.value) {
      bottomBarHeight.value = bottomBarRef.value.offsetHeight
    }
  })
}

// Data loading
const loadProduct = async (id: string) => {
  loading.value = true
  error.value = ''
  
  try {
    // Load categories if needed
    if (!catalogStore.categories.length) {
      await catalogStore.fetchCategories()
    }
    
    // Clear old product if ID doesn't match
    if (catalogStore.currentProduct && catalogStore.currentProduct.id !== id) {
      catalogStore.clearCurrentProduct()
    }
    
    // Load product
    await catalogStore.fetchProduct(id)
    
    if (!catalogStore.currentProduct || catalogStore.currentProduct.id !== id) {
      error.value = 'Товар не найден'
    } else {
      // Инициализируем первый доступный вариант (stock > 0), если есть варианты
      if (catalogStore.currentProduct.hasVariants && catalogStore.currentProduct.variants && catalogStore.currentProduct.variants.length > 0) {
        const firstAvailable = catalogStore.currentProduct.variants.find(v => {
          if (v.isAvailable === false) return false
          if (typeof v.stock === 'number') return v.stock > 0
          return true
        })
        selectedVariantId.value = firstAvailable?.id || null
      } else {
        selectedVariantId.value = null
      }
    }
    
    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось загрузить товар'
  } finally {
    loading.value = false
  }
}

// Lifecycle
onMounted(async () => {
  await loadProduct(props.id)
  
  // Update bottom bar height
  updateBottomBarHeight()
  
  // Add animation after mount
  await nextTick()
  document.querySelector('.product-page')?.classList.add('mounted')
})

// Watch for route changes
watch(
  () => props.id,
  async (newId, oldId) => {
    if (newId !== oldId) {
      showPurchaseModalState.value = false
      await loadProduct(newId)
      currentSlide.value = 0
      updateBottomBarHeight()
    }
  },
  { immediate: false }
)

// Watch product changes for height update
watch(
  () => product.value,
  () => {
    updateBottomBarHeight()
  }
)

onBeforeRouteUpdate(async (to) => {
  const id = to.params.id as string
  showPurchaseModalState.value = false
  await loadProduct(id)
  currentSlide.value = 0
})
</script>

<style scoped>
/* Page animations */
.product-page {
  will-change: transform, opacity;
}

.product-page.mounted {
  animation: pageEnter 0.5s ease-out;
}

/* Hide scrollbar for variant selector */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

@keyframes pageEnter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Safe area for iOS */
.h-safe-bottom {
  height: env(safe-area-inset-bottom, 0);
}

/* Custom scrollbar hide */
.scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Desktop-specific styles */
@media (min-width: 1024px) {
  .product-page {
    background-color: #fafafa;
  }
  
  .sticky {
    position: -webkit-sticky;
    position: sticky;
  }
  
  /* Smooth hover effects for desktop */
  .hover\:scale-102:hover {
    transform: scale(1.02);
  }
  
  .hover\:scale-105:hover {
    transform: scale(1.05);
  }
  
  .active\:scale-98:active {
    transform: scale(0.98);
  }
  
  /* Custom ring styles */
  .ring-brand-primary\/50 {
    --tw-ring-opacity: 0.5;
    --tw-ring-color: rgb(255 200 26 / var(--tw-ring-opacity));
  }
}
</style>
