<template>
  <button
    v-if="visible"
    type="button"
    class="favorite-button"
    :class="{ 'favorite-button--pending': isPending }"
    :disabled="isPending"
    :aria-pressed="isOn ? 'true' : 'false'"
    :aria-label="isOn ? 'Убрать линейку из избранного' : 'Добавить всю линейку в избранное'"
    @click.stop.prevent="onToggle"
  >
    <svg class="favorite-button__heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"
      />
    </svg>
    <span>Избранное</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { FavoritesAuthError } from '@/utils/favoritesApi'
import { hasTelegramMiniAppUserContext } from '@/utils/telegramMiniAppContext'

const props = defineProps<{
  groupId: string
}>()

const favoritesStore = useFavoritesStore()

const visible = computed(() => Boolean(props.groupId) && hasTelegramMiniAppUserContext())

const isOn = computed(() => favoritesStore.isGroupFavorite(props.groupId))

const isPending = computed(() => favoritesStore.isGroupTogglePending(props.groupId))

async function onToggle() {
  if (isPending.value) return
  try {
    const nextOn = await favoritesStore.toggleFavoriteGroup(props.groupId)
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
      nextOn ? 'success' : 'warning',
    )
  } catch (error) {
    if (error instanceof FavoritesAuthError) return
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('error')
    if (window.Telegram?.WebApp?.showAlert) {
      window.Telegram.WebApp.showAlert(
        'Не удалось сохранить избранное. Попробуйте ещё раз',
      )
    }
  }
}
</script>

<!-- Копия утверждённого макета favorite-button.html: пилюля с сердцем
     и подписью, состояние — только через aria-pressed. -->
<style scoped>
.favorite-button {
  --favorite-bg: #f1f2f6;
  --favorite-text: #343943;
  --favorite-red-start: #e62c20;
  --favorite-red-end: #a92520;
  --favorite-height: 30px;

  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 0 auto;
  width: max-content;
  min-height: var(--favorite-height);
  margin: 0;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: var(--favorite-bg);
  color: var(--favorite-text);
  box-shadow: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: color 140ms ease, transform 120ms ease;
}

/* Невидимая зона нажатия высотой минимум 44px.
   Не меняет видимую высоту и не растягивает карточку.
   При интеграции оставляйте минимум 7px до соседних интерактивных зон. */
.favorite-button::before {
  content: '';
  position: absolute;
  inset: -7px 0;
  border-radius: inherit;
}

.favorite-button[aria-pressed='true'] {
  background: linear-gradient(110deg, var(--favorite-red-start) 0%, var(--favorite-red-end) 100%);
  color: #fff;
}

.favorite-button__heart {
  display: block;
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.favorite-button[aria-pressed='true'] .favorite-button__heart {
  fill: currentColor;
}

.favorite-button:active {
  transform: scale(0.97);
}

.favorite-button:focus-visible {
  outline: 2px solid #b92520;
  outline-offset: 4px;
}

.favorite-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.favorite-button:disabled:active {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .favorite-button {
    transition: none;
  }
  .favorite-button:active {
    transform: none;
  }
}
</style>
