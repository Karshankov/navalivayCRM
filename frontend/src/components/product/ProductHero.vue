<template>
  <div class="product-hero relative w-full">
    <!-- Mobile Gallery View -->
    <div class="lg:hidden">
      <div class="relative w-full bg-gradient-to-b from-gray-50 to-white">
        <!-- Main Image Carousel -->
        <div 
          ref="emblaRef"
          class="embla overflow-hidden"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove" 
          @touchend="onTouchEnd"
        >
          <div class="embla__container flex">
            <div
              v-for="(image, idx) in images"
              :key="`slide-${idx}`"
              class="embla__slide relative min-w-full"
            >
              <!-- Aspect Ratio Container -->
              <div class="relative w-full" style="padding-bottom: 125%"> <!-- 4:5 aspect ratio -->
                <div class="absolute inset-0 bg-white">
                  <!-- Skeleton Loading -->
                  <Transition
                    enter-active-class="transition-opacity duration-300"
                    enter-from-class="opacity-100"
                    enter-to-class="opacity-0"
                    leave-active-class="transition-opacity duration-150"
                    leave-from-class="opacity-0"
                    leave-to-class="opacity-100"
                  >
                    <div 
                      v-if="!imageLoadStates[idx]"
                      class="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse"
                    />
                  </Transition>
                  
                  <!-- Actual Image -->
                  <img
                    :src="image"
                    :alt="`${productTitle} - Фото ${idx + 1}`"
                    class="w-full h-full object-cover transition-transform duration-300 cursor-pointer"
                    :class="{ 'scale-105': currentSlide === idx && isZoomed }"
                    @load="onImageLoad(idx)"
                    @error="onImageError"
                    @click="openFullscreen"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Navigation Dots -->
        <div 
          v-if="images.length > 1"
          class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-black/20 backdrop-blur-md rounded-full"
        >
          <button
            v-for="(_, idx) in images"
            :key="`dot-${idx}`"
            @click="goToSlide(idx)"
            class="transition-all duration-300"
            :class="[
              idx === currentSlide 
                ? 'w-6 h-2 bg-white rounded-full shadow-lg' 
                : 'w-2 h-2 bg-white/60 rounded-full hover:bg-white/80'
            ]"
            :aria-label="`Перейти к фото ${idx + 1}`"
            :aria-current="idx === currentSlide ? 'true' : 'false'"
          />
        </div>

        <!-- Quick Actions Bar -->
        <div class="absolute top-4 left-0 right-0 flex justify-between items-center px-4 z-10">
          <!-- Back Button -->
          <button
            @click="router.back()"
            class="w-10 h-10 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all"
            aria-label="Назад"
          >
            <ChevronLeftIcon class="w-5 h-5 text-brand-dark" />
          </button>

        </div>

        <!-- Badge Container -->
        <div 
          v-if="badges.length > 0"
          class="absolute top-16 left-4 flex flex-col gap-2"
        >
          <TransitionGroup
            enter-active-class="transition-all duration-500"
            enter-from-class="opacity-0 -translate-x-4"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition-all duration-300"
            leave-from-class="opacity-100 translate-x-0"
            leave-to-class="opacity-0 -translate-x-4"
          >
            <div
              v-for="(badge, idx) in badges"
              :key="`badge-${badge.type}`"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-lg backdrop-blur-md"
              :class="getBadgeClass(badge.type)"
              :style="{ transitionDelay: `${idx * 100}ms` }"
            >
              <component :is="getBadgeIcon(badge.type)" class="w-4 h-4" />
              <span class="text-xs font-bold uppercase tracking-wider">{{ badge.text }}</span>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <!-- Thumbnails Strip -->
      <div 
        v-if="images.length > 1"
        class="px-4 py-4 bg-white"
      >
        <div class="flex gap-2 overflow-x-auto scrollbar-hide py-2 px-2">
          <button
            v-for="(image, idx) in images"
            :key="`thumb-${idx}`"
            @click="goToSlide(idx)"
            class="relative flex-shrink-0 w-16 h-20 rounded-lg overflow-hidden transition-all duration-300 focus:outline-none"
            :class="[
              idx === currentSlide 
                ? 'border-2 border-brand-primary scale-105' 
                : 'border border-gray-300 hover:border-brand-primary/50'
            ]"
          >
            <img
              :src="image"
              :alt="`Миниатюра ${idx + 1}`"
              class="w-full h-full object-cover"
              loading="lazy"
            />
            <!-- Active Indicator -->
            <Transition
              enter-active-class="transition-opacity duration-300"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-200"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-if="idx === currentSlide"
                class="absolute inset-0 bg-brand-primary/20"
              />
            </Transition>
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop Gallery View -->
    <div class="hidden lg:block">
      <div class="relative bg-gradient-to-b from-gray-50 to-white rounded-2xl overflow-hidden shadow-sm">
        <!-- Main Image Container -->
        <div class="aspect-square w-full relative">
          <!-- Badges -->
          <div 
            v-if="badges.length > 0"
            class="absolute top-6 left-6 flex flex-col gap-3 z-10"
          >
            <TransitionGroup
              enter-active-class="transition-all duration-500"
              enter-from-class="opacity-0 -translate-x-4"
              enter-to-class="opacity-100 translate-x-0"
            >
              <div
                v-for="(badge, idx) in badges"
                :key="`desktop-badge-${badge.type}`"
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
            :alt="`${productTitle} - Фото ${currentSlide + 1}`"
            class="w-full h-full object-cover cursor-pointer transition-transform duration-300 hover:scale-105"
            @click="openFullscreen"
            loading="eager"
          />
        </div>

        <!-- Desktop Navigation Arrows -->
        <button
          v-if="images.length > 1 && currentSlide > 0"
          @click="goToSlide(currentSlide - 1)"
          class="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
          aria-label="Предыдущее фото"
        >
          <ChevronLeftIcon class="w-6 h-6 text-brand-dark" />
        </button>
        
        <button
          v-if="images.length > 1 && currentSlide < images.length - 1"
          @click="goToSlide(currentSlide + 1)"
          class="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all z-10"
          aria-label="Следующее фото"
        >
          <ChevronRightIcon class="w-6 h-6 text-brand-dark" />
        </button>

        <!-- Desktop Dots Indicator -->
        <div 
          v-if="images.length > 1"
          class="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-black/20 backdrop-blur-md rounded-full"
        >
          <button
            v-for="(_, idx) in images"
            :key="`desktop-dot-${idx}`"
            @click="goToSlide(idx)"
            class="transition-all duration-300"
            :class="[
              idx === currentSlide 
                ? 'w-8 h-2 bg-white rounded-full shadow-lg' 
                : 'w-2 h-2 bg-white/60 rounded-full hover:bg-white/80'
            ]"
            :aria-label="`Перейти к фото ${idx + 1}`"
            :aria-current="idx === currentSlide ? 'true' : 'false'"
          />
        </div>
      </div>

      <!-- Desktop Thumbnails -->
      <div v-if="images.length > 1" class="mt-6 grid grid-cols-6 gap-3">
        <button
          v-for="(image, idx) in images"
          :key="`desktop-thumb-${idx}`"
          @click="goToSlide(idx)"
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

    <!-- Fullscreen Image Viewer -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-300"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-all duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isFullscreen"
          class="fixed inset-0 z-[100] bg-white/80 backdrop-blur-lg flex items-center justify-center"
          style="margin: 0; padding: 0; border: none; width: 100vw; height: 100vh; left: 0; top: 0;"
          @click="closeFullscreen"
          @touchstart="onFullscreenTouchStart"
          @touchmove="onFullscreenTouchMove"
          @touchend="onFullscreenTouchEnd"
        >
          <!-- Close Button -->
          <button
            @click="closeFullscreen"
            class="absolute top-4 right-4 z-10 w-12 h-12 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all"
            aria-label="Закрыть"
          >
            <XMarkIcon class="w-6 h-6" />
          </button>

          <!-- Counter -->
          <div class="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full">
            <span class="text-white text-sm font-medium">
              {{ fullscreenIndex + 1 }} / {{ images.length }}
            </span>
          </div>

          <!-- Images Strip Container -->
          <div 
            class="flex w-full h-full"
            :style="{
              transform: `translateX(${-fullscreenIndex * 100 + (screenWidth ? fullscreenSwipeOffset / screenWidth * 100 : 0)}vw)`,
              transition: fullscreenTransition ? 'transform 0.3s ease-out' : 'none'
            }"
            @click.stop
          >
            <div
              v-for="(image, idx) in images"
              :key="`fullscreen-${idx}`"
              class="flex-shrink-0 w-screen h-full flex items-center justify-center"
            >
              <img
                :src="image"
                :alt="`${productTitle} - Полный размер ${idx + 1}`"
                class="max-w-full max-h-full object-contain"
              />
            </div>
          </div>

          <!-- Navigation -->
          <button
            v-if="fullscreenIndex > 0"
            @click.stop="fullscreenPrev"
            class="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all"
            aria-label="Предыдущее фото"
          >
            <ChevronLeftIcon class="w-6 h-6" />
          </button>
          <button
            v-if="fullscreenIndex < images.length - 1"
            @click.stop="fullscreenNext"
            class="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all"
            aria-label="Следующее фото"
          >
            <ChevronRightIcon class="w-6 h-6" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import emblaCarouselVue from 'embla-carousel-vue'
import { 
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  FireIcon,
  SparklesIcon,
  BoltIcon,
  ShieldCheckIcon
} from '@heroicons/vue/24/outline'

interface Badge {
  type: 'new' | 'hot' | 'sale' | 'exclusive' | 'lastpiece'
  text: string
}

interface Props {
  images: string[]
  productTitle?: string
  badges?: Badge[]
  initialSlide?: number
  externalCurrentSlide?: number
}

const props = withDefaults(defineProps<Props>(), {
  productTitle: 'Товар',
  badges: () => [],
  initialSlide: 0,
  externalCurrentSlide: undefined
})

const emit = defineEmits<{
  slideChange: [index: number]
}>()

const router = useRouter()

// Carousel setup
const [emblaRef, emblaApi] = emblaCarouselVue({ 
  loop: true,
  align: 'center',
  skipSnaps: false,
  containScroll: 'trimSnaps'
})

// State
const currentSlide = ref(0)
const isZoomed = ref(false)
const isFullscreen = ref(false)
const fullscreenIndex = ref(0)
const imageLoadStates = ref<boolean[]>([])

// Touch handling for custom gestures
const touchStartX = ref(0)
const touchStartY = ref(0)
const touchStartTime = ref(0)
const isPinching = ref(false)

// Fullscreen touch handling
const fullscreenTouchStartX = ref(0)
const fullscreenTouchStartY = ref(0)
const fullscreenTouchStartTime = ref(0)
const fullscreenSwipeOffset = ref(0)
const isFullscreenSwiping = ref(false)
const fullscreenTransition = ref(false)
const screenWidth = ref(0)

// Initialize
onMounted(() => {
  imageLoadStates.value = new Array(props.images.length).fill(false)
  screenWidth.value = window.innerWidth
  
  if (emblaApi.value) {
    emblaApi.value.on('select', onSelect)
    emblaApi.value.scrollTo(props.initialSlide, false)
  }
  
  // Update screen width on resize
  window.addEventListener('resize', () => {
    screenWidth.value = window.innerWidth
  })
})

// Watch for external slide changes (from desktop)
watch(() => props.externalCurrentSlide, (newSlide) => {
  if (newSlide !== undefined && newSlide !== currentSlide.value) {
    currentSlide.value = newSlide
    emblaApi.value?.scrollTo(newSlide)
  }
})

function onSelect() {
  if (!emblaApi.value) return
  const newIndex = emblaApi.value.selectedScrollSnap()
  currentSlide.value = newIndex
  emit('slideChange', newIndex)
}

// Navigation
function goToSlide(index: number) {
  emblaApi.value?.scrollTo(index)
  hapticFeedback('light')
}

// Image handling
function onImageLoad(index: number) {
  imageLoadStates.value[index] = true
}

function onImageError(event: Event) {
  const target = event.target as HTMLImageElement
  target.src = '/placeholder-product.jpg'
}

// Zoom & Fullscreen
function toggleZoom() {
  isZoomed.value = !isZoomed.value
  hapticFeedback('light')
}

function openFullscreen() {
  isFullscreen.value = true
  fullscreenIndex.value = currentSlide.value
  hapticFeedback('medium')
  
  // Prevent body scroll
  document.body.style.overflow = 'hidden'
}

function closeFullscreen() {
  isFullscreen.value = false
  document.body.style.overflow = ''
  hapticFeedback('light')
}

function fullscreenPrev() {
  if (fullscreenIndex.value > 0) {
    fullscreenIndex.value--
    hapticFeedback('light')
  }
}

function fullscreenNext() {
  if (fullscreenIndex.value < props.images.length - 1) {
    fullscreenIndex.value++
    hapticFeedback('light')
  }
}

// Touch gestures
function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    touchStartX.value = e.touches[0].clientX
    touchStartY.value = e.touches[0].clientY
    touchStartTime.value = Date.now()
  } else if (e.touches.length === 2) {
    isPinching.value = true
  }
}

function onTouchMove(e: TouchEvent) {
  if (isPinching.value && e.touches.length === 2) {
    // Handle pinch zoom
    e.preventDefault()
  }
}

function onTouchEnd(e: TouchEvent) {
  if (isPinching.value) {
    isPinching.value = false
    return
  }
  
  const touchEndTime = Date.now()
  const touchDuration = touchEndTime - touchStartTime.value
  
  // Quick tap to zoom
  if (touchDuration < 200 && e.changedTouches.length === 1) {
    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = Math.abs(touchEndX - touchStartX.value)
    const deltaY = Math.abs(touchEndY - touchStartY.value)
    
    if (deltaX < 10 && deltaY < 10) {
      toggleZoom()
    }
  }
}

// Fullscreen touch gestures
function onFullscreenTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    fullscreenTouchStartX.value = e.touches[0].clientX
    fullscreenTouchStartY.value = e.touches[0].clientY
    fullscreenTouchStartTime.value = Date.now()
    isFullscreenSwiping.value = true
    fullscreenTransition.value = false
    fullscreenSwipeOffset.value = 0
  }
}

function onFullscreenTouchMove(e: TouchEvent) {
  if (e.touches.length === 1 && isFullscreenSwiping.value) {
    e.preventDefault()
    
    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = currentX - fullscreenTouchStartX.value
    const deltaY = Math.abs(currentY - fullscreenTouchStartY.value)
    
    // Check if this is more horizontal than vertical movement
    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
      // Apply resistance at the edges
      let offset = deltaX
      
      // Add resistance when trying to swipe past first/last image
      if ((fullscreenIndex.value === 0 && deltaX > 0) || 
          (fullscreenIndex.value === props.images.length - 1 && deltaX < 0)) {
        offset = deltaX * 0.3 // Reduced movement with resistance
      }
      
      fullscreenSwipeOffset.value = offset
    }
  }
}

function onFullscreenTouchEnd(e: TouchEvent) {
  if (!isFullscreenSwiping.value) return
  
  isFullscreenSwiping.value = false
  fullscreenTransition.value = true
  
  const touchEndTime = Date.now()
  const touchDuration = touchEndTime - fullscreenTouchStartTime.value
  const deltaX = fullscreenSwipeOffset.value
  const absSwipeDistance = Math.abs(deltaX)
  const swipeThreshold = screenWidth.value * 0.25 // 25% of screen width
  const fastSwipeThreshold = screenWidth.value * 0.15 // 15% for fast swipes
  
  // Determine if we should switch image based on distance and velocity
  const shouldSwitch = absSwipeDistance > swipeThreshold || 
                      (absSwipeDistance > fastSwipeThreshold && touchDuration < 300)
  
  if (shouldSwitch && absSwipeDistance > 20) {
    if (deltaX > 0 && fullscreenIndex.value > 0) {
      // Swipe right - previous image
      fullscreenPrev()
    } else if (deltaX < 0 && fullscreenIndex.value < props.images.length - 1) {
      // Swipe left - next image
      fullscreenNext()
    }
  }
  
  // Reset offset with animation
  setTimeout(() => {
    fullscreenSwipeOffset.value = 0
  }, 50)
  
  // Disable transition after animation completes
  setTimeout(() => {
    fullscreenTransition.value = false
  }, 350)
}


// Badge styling
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

// Haptic feedback
function hapticFeedback(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (window.Telegram?.WebApp?.HapticFeedback) {
    window.Telegram.WebApp.HapticFeedback.impactOccurred(style)
  }
}
</script>

<style scoped>
.embla {
  --slide-spacing: 0;
  --slide-size: 100%;
}

.embla__container {
  backface-visibility: hidden;
  touch-action: pan-y pinch-zoom;
}

.embla__slide {
  flex: 0 0 var(--slide-size);
  min-width: 0;
  padding-left: var(--slide-spacing);
}

/* Smooth image transitions */
.embla__slide img {
  will-change: transform;
  transform: translateZ(0);
}

/* Scrollbar hide */
.scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>