<template>
  <header class="app-header" :class="{ 'app-header--scrolled': scrolled }">
    <div class="app-header__inner">
      <Transition name="title-slide" mode="out-in">
        <h1 :key="title" class="app-header__title">{{ title }}</h1>
      </Transition>

      <div class="app-header__actions">
        <!-- Корзина: всегда, с бейджем количества -->
        <router-link
          to="/checkout"
          class="app-header__icon-button"
          aria-label="Корзина"
        >
          <span class="app-header__cart-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 4H5L7 14H17L19 6H6"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="9" cy="18" r="1.6" stroke="currentColor" stroke-width="1.6" />
              <circle cx="16" cy="18" r="1.6" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </span>
          <Transition name="badge-pop">
            <span v-if="cartStore.totalItems > 0" class="app-header__cart-badge">
              {{ cartBadgeLabel }}
            </span>
          </Transition>
        </router-link>

        <!-- Профиль: аватар из Telegram -->
        <router-link
          to="/profile"
          class="app-header__avatar-link"
          aria-label="Профиль"
        >
          <img
            v-if="userStore.photoUrl && !avatarError"
            :src="userStore.photoUrl"
            :alt="userStore.displayName"
            class="app-header__avatar"
            @error="avatarError = true"
          />
          <span v-else class="app-header__avatar app-header__avatar--placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="#5C6670" stroke-width="1.8" />
              <path
                d="M4 21C4 17.134 7.58172 14 12 14C16.4183 14 20 17.134 20 21"
                stroke="#5C6670"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </span>
        </router-link>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import { useCartStore } from "@/stores/cart";
import { useUserStore } from "@/stores/user";

/**
 * Шапка шелла: слева заголовок активной вкладки (плавная смена), справа
 * корзина с бейджем и аватар профиля из Telegram. Рулетка и избранное
 * живут только на главной вкладке (HomeView), шапка чистая.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    scrolled?: boolean;
  }>(),
  {
    scrolled: false,
  },
);

const cartStore = useCartStore();
const userStore = useUserStore();
const avatarError = ref(false);

const cartBadgeLabel = computed(() => {
  const count = cartStore.totalItems;
  return count > 99 ? "99+" : String(count);
});
</script>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 50;
  padding-top: env(safe-area-inset-top, 0px);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.app-header--scrolled {
  border-bottom-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 1px 12px rgba(16, 24, 40, 0.06);
}

.app-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
}

.app-header__title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #191919;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Плавная смена заголовка между вкладками */
.title-slide-enter-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.title-slide-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.title-slide-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.title-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.app-header__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 0 0 auto;
}

.app-header__icon-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: #1f2933;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.app-header__icon-button:active {
  opacity: 0.6;
  transform: scale(0.92);
}

.app-header__icon-button svg {
  width: 22px;
  height: 22px;
}

.app-header__cart-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-header__cart-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: #f50302;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  box-sizing: border-box;
  pointer-events: none;
}

.badge-pop-enter-active,
.badge-pop-leave-active {
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.15s ease;
}

.badge-pop-enter-from,
.badge-pop-leave-to {
  transform: scale(0.4);
  opacity: 0;
}

.app-header__avatar-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.app-header__avatar-link:active {
  transform: scale(0.92);
}

.app-header__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  transition: box-shadow 0.2s ease;
}

.app-header__avatar--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef1f5;
}

.app-header__avatar--placeholder svg {
  width: 20px;
  height: 20px;
}
</style>
