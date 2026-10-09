<template>
  <section v-if="banners.length" class="relative w-full banner-section">
    <!-- Single banner -->
    <template v-if="banners.length === 1">
      <div
        class="single-banner-wrapper"
        @click="handleBannerClick(banners[0])"
      >
        <img
          :src="imageOf(banners[0])"
          alt="Banner"
          class="single-banner-image"
          loading="lazy"
          draggable="false"
        />
      </div>
    </template>

    <!-- Multiple banners: carousel -->
    <template v-else>
      <div class="carousel-container-new" ref="carouselRef">
        <div
          class="carousel-track-new"
          :style="{ transform: `translateX(-${currentSlide * 100}%)` }"
          @touchstart.passive="onTouchStart"
          @touchmove.passive="onTouchMove"
          @touchend="onTouchEnd"
        >
          <div
            v-for="(banner, index) in banners"
            :key="banner.id"
            class="carousel-slide-new"
            :class="{ active: index === currentSlide }"
          >
            <img
              :src="imageOf(banner)"
              :alt="`Banner ${index + 1}`"
              class="carousel-image-new"
              loading="lazy"
              draggable="false"
            />
          </div>
        </div>

        <!-- Left/Right tap zones -->
        <div class="tap-zone tap-zone-left" @click="onTapLeft"></div>
        <div class="tap-zone tap-zone-right" @click="onTapRight"></div>

        <!-- Onboarding overlay -->
        <Transition name="fade">
          <div 
            v-if="showOnboarding" 
            class="banner-onboarding"
            @click="dismissOnboarding"
          >
            <div class="onboarding-hint onboarding-hint-left">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </div>
            <div class="onboarding-center">
              <span class="onboarding-text">Нажмите по краям для переключения</span>
            </div>
            <div class="onboarding-hint onboarding-hint-right">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Dot indicators -->
      <div class="carousel-dots">
        <button
          v-for="(banner, index) in banners"
          :key="`dot-${banner.id}`"
          class="carousel-dot"
          :class="{ active: index === currentSlide }"
          @click="goToSlide(index)"
          :aria-label="`Go to slide ${index + 1}`"
        ></button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import type { Banner } from "@/stores/catalog";

interface Props {
  banners: Banner[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

const props = withDefaults(defineProps<Props>(), {
  autoPlay: true,
  autoPlayInterval: 5000,
});

const router = useRouter();
const carouselRef = ref<HTMLElement | null>(null);
const currentSlide = ref(0);
const autoPlayTimer = ref<ReturnType<typeof setInterval>>();

// Touch tracking
const touchStartX = ref(0);
const touchStartY = ref(0);
const touchStartTime = ref(0);
const isSwiping = ref(false);

// Onboarding
const ONBOARDING_KEY = 'navalivay_banner_onboarding_seen';
const showOnboarding = ref(false);

function imageOf(banner: Banner) {
  return (banner as any).image || (banner as any).imageUrl || "";
}

// Navigation
function nextSlide() {
  currentSlide.value = (currentSlide.value + 1) % props.banners.length;
  resetAutoPlay();
}

function prevSlide() {
  currentSlide.value = currentSlide.value === 0 
    ? props.banners.length - 1 
    : currentSlide.value - 1;
  resetAutoPlay();
}

function goToSlide(index: number) {
  currentSlide.value = index;
  resetAutoPlay();
}

// AutoPlay
function startAutoPlay() {
  if (props.autoPlay && props.banners.length > 1) {
    autoPlayTimer.value = setInterval(nextSlide, props.autoPlayInterval);
  }
}

function stopAutoPlay() {
  if (autoPlayTimer.value) {
    clearInterval(autoPlayTimer.value);
    autoPlayTimer.value = undefined;
  }
}

function resetAutoPlay() {
  stopAutoPlay();
  startAutoPlay();
}

// Touch handlers - simple swipe detection
function onTouchStart(e: TouchEvent) {
  touchStartX.value = e.touches[0].clientX;
  touchStartY.value = e.touches[0].clientY;
  touchStartTime.value = Date.now();
  isSwiping.value = false;
  stopAutoPlay();
}

function onTouchMove(e: TouchEvent) {
  const deltaX = e.touches[0].clientX - touchStartX.value;
  const deltaY = e.touches[0].clientY - touchStartY.value;
  
  // If horizontal movement is greater, mark as swiping
  if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
    isSwiping.value = true;
  }
}

function onTouchEnd(e: TouchEvent) {
  const touchEndX = e.changedTouches[0].clientX;
  const deltaX = touchEndX - touchStartX.value;
  const elapsed = Date.now() - touchStartTime.value;
  
  // Swipe threshold: 50px or fast swipe (velocity)
  const threshold = 50;
  const velocity = Math.abs(deltaX) / elapsed;
  
  if (Math.abs(deltaX) > threshold || (velocity > 0.5 && Math.abs(deltaX) > 20)) {
    if (deltaX < 0) {
      nextSlide();
    } else {
      prevSlide();
    }
  } else {
    startAutoPlay();
  }
  
  isSwiping.value = false;
}

// Tap zone handlers
function onTapLeft() {
  if (isSwiping.value) return;
  prevSlide();
  dismissOnboarding();
}

function onTapRight() {
  if (isSwiping.value) return;
  nextSlide();
  dismissOnboarding();
}

// Banner click (for single banner or center tap)
function handleBannerClick(banner: Banner) {
  const href = (banner as any).href;
  if (!href) return;
  
  const openInNewTab = (banner as any).openInNewTab === 1 || 
                       (banner as any).openInNewTab === true || 
                       (banner as any).openInNewTab === "1";

  if (href.startsWith("http")) {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(href);
    } else if (openInNewTab) {
      window.open(href, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = href;
    }
  } else {
    if (openInNewTab) {
      window.open(window.location.origin + href, "_blank", "noopener,noreferrer");
    } else {
      router.push(href);
    }
  }
}

// Onboarding
function checkOnboarding() {
  if (props.banners.length <= 1) return;
  try {
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setTimeout(() => {
        showOnboarding.value = true;
        // Stop autoplay while onboarding is shown
        stopAutoPlay();
      }, 1000);
    }
  } catch (e) {}
}

function dismissOnboarding() {
  if (!showOnboarding.value) return;
  showOnboarding.value = false;
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch (e) {}
  // Resume autoplay after onboarding dismissed
  startAutoPlay();
}

onMounted(() => {
  startAutoPlay();
  checkOnboarding();
});

onUnmounted(() => {
  stopAutoPlay();
});
</script>

<style scoped>
/* Banner section */
.banner-section {
  position: relative;
  padding: 0 8px;
  margin-top: 0;
}

/* Single banner */
.single-banner-wrapper {
  width: 100%;
  cursor: pointer;
  border-radius: 24px;
  overflow: hidden;
  position: relative;
  background-color: #f0f0f0;
  padding-bottom: 50%; /* 2:1 aspect ratio fallback */
  height: 0;
}

@supports (aspect-ratio: 2 / 1) {
  .single-banner-wrapper {
    padding-bottom: 0;
    height: auto;
  }
}

.single-banner-image {
  width: 100%;
  display: block;
  object-fit: cover;
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
}

@supports (aspect-ratio: 2 / 1) {
  .single-banner-image {
    position: static;
    height: auto;
    aspect-ratio: 2 / 1;
  }
}

/* Carousel container */
.carousel-container-new {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 24px;
}

.carousel-track-new {
  display: flex;
  transition: transform 0.4s ease-out;
  touch-action: pan-y pinch-zoom;
  user-select: none;
}

.carousel-slide-new {
  flex: 0 0 100%;
  min-width: 100%;
  position: relative;
  background-color: #f0f0f0;
  padding-bottom: 50%; /* 2:1 aspect ratio fallback */
  height: 0;
}

@supports (aspect-ratio: 2 / 1) {
  .carousel-slide-new {
    padding-bottom: 0;
    height: auto;
  }
}

.carousel-image-new {
  width: 100%;
  display: block;
  object-fit: cover;
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
}

@supports (aspect-ratio: 2 / 1) {
  .carousel-image-new {
    position: static;
    height: auto;
    aspect-ratio: 2 / 1;
  }
}

/* Tap zones - invisible clickable areas on sides */
.tap-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 25%;
  z-index: 5;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tap-zone-left {
  left: 0;
}

.tap-zone-right {
  right: 0;
}

/* Subtle feedback on tap */
.tap-zone:active {
  background: rgba(255, 255, 255, 0.1);
}

/* Dot indicators */
.carousel-dots {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px 0 8px;
}

.carousel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: #aab2bd;
  cursor: pointer;
  padding: 0;
  transition: all 0.3s ease;
}

.carousel-dot.active {
  width: 10px;
  height: 10px;
  background: #fa0001;
  box-shadow: 0px 6px 24px rgba(250, 0, 1, 0.12);
}

.carousel-dot:hover:not(.active) {
  background: #8a919a;
}

/* Onboarding overlay */
.banner-onboarding {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 10;
  cursor: pointer;
  border-radius: 24px;
  padding: 0 12px;
}

.onboarding-hint {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  animation: pulse-hint 1.5s ease-in-out infinite;
}

.onboarding-hint-left {
  animation-delay: 0s;
}

.onboarding-hint-right {
  animation-delay: 0.75s;
}

@keyframes pulse-hint {
  0%, 100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.15);
    opacity: 1;
  }
}

.onboarding-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.onboarding-text {
  color: white;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  line-height: 1.3;
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
