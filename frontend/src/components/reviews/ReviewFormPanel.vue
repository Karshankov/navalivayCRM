<template>
  <Teleport to="body">
    <Transition name="rs-fade">
      <div v-if="open" class="rs-mask" aria-hidden="true" @click="requestClose" />
    </Transition>

    <section
      v-if="open"
      ref="shellRef"
      class="rs-shell rw-shell"
      :class="{ 'rs-shell--full': expanded, 'rs-shell--closing': closing }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rw-panel-title"
    >
      <div
        ref="panelRef"
        class="rs-panel"
        :class="{ 'rs-dragging': dragging }"
        :style="panelStyle"
        tabindex="-1"
        @keydown="handleKeydown"
      >
        <div
          class="rs-grip"
          @pointerdown="onDragStart"
          @pointermove="onDragMove"
          @pointerup="onDragEnd"
          @pointercancel="onDragCancel"
        >
          <i />
        </div>

        <header
          class="rs-head"
          @pointerdown="onDragStart"
          @pointermove="onDragMove"
          @pointerup="onDragEnd"
          @pointercancel="onDragCancel"
        >
          <div>
            <h2 id="rw-panel-title">Как вам этот товар?</h2>
            <p>Выставьте оценку и поделитесь отзывом</p>
          </div>
          <div class="rs-head-actions">
            <button
              type="button"
              class="rs-icon-button rs-close"
              aria-label="Закрыть форму отзыва"
              @click="requestClose"
            >
              ×
            </button>
          </div>
        </header>

        <div
          ref="scrollRef"
          class="rs-scroll"
          @touchstart.passive="onListTouchStart"
          @touchmove="onListTouchMove"
          @touchend.passive="onListTouchEnd"
          @touchcancel="onListTouchCancel"
        >
          <!-- Переход между позициями: форма не сменяется отдельным
               экраном, а затухает и появляется заново с новым товаром. -->
          <Transition name="rw-swap" mode="out-in">
            <form :key="formKey" class="rw-form" @submit.prevent="submit">
              <div class="rw-product">
              <span class="rw-photo">
                <img
                  v-if="imageUrl && !imageBroken"
                  :src="imageUrl"
                  :alt="title"
                  @error="imageBroken = true"
                />
                <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m4 18 6-6 4 4 3-3 4 5" />
                </svg>
              </span>
              <div>
                <strong>{{ title }}</strong>
                <p v-if="subtitle">{{ subtitle }}</p>
              </div>
            </div>

            <fieldset class="rw-rating">
              <legend>Ваша оценка</legend>
              <div class="rw-stars">
                <template v-for="star in 5" :key="star">
                  <input
                    :id="`rw-${star}`"
                    v-model.number="rating"
                    class="rw-radio"
                    type="radio"
                    name="product-rating"
                    :value="star"
                    :aria-label="`${star} из 5`"
                  />
                  <label
                    class="rw-star"
                    :class="{ 'rw-filled': star <= rating }"
                    :for="`rw-${star}`"
                    aria-hidden="true"
                  >
                    ★
                  </label>
                </template>
              </div>
            </fieldset>

            <label class="rw-comment-label rw-sr-only" for="rw-comment">Ваш отзыв</label>
            <textarea
              id="rw-comment"
              v-model="bodyText"
              name="comment"
              maxlength="2000"
              rows="4"
              :placeholder="commentPlaceholder"
            />

            <!-- Текст необязателен: отзыв можно оставить одной оценкой. -->
            <div class="rw-note">
              <span>{{ bodyHint }}</span>
              <span class="rw-counter">{{ bodyText.length }} / {{ MAX_BODY }}</span>
            </div>

            <button class="rw-submit" type="submit" :disabled="!canSubmit">
              {{ submitting ? "Отправляем…" : "Отправить отзыв" }}
            </button>

              <p v-if="errorMessage" class="rw-submit-error" role="alert">
                {{ errorMessage }}
              </p>
            </form>
          </Transition>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSlidingPanel } from "@/composables/useSlidingPanel";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

const props = defineProps<{
  open: boolean;
  orderId: string | null;
  groupId: string | null;
  orderItemId?: string | null;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  /** Есть ли ещё покупка для оценки: от этого зависит кнопка перехода. */
  hasNext?: boolean;
  /** Сколько всего покупок ждёт оценки. */
  pendingCount?: number;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submitted"): void;
  /** Просят открыть форму для следующей покупки. */
  (e: "next"): void;
}>();

/** Ограничение только сверху: текст можно не писать вовсе, тогда
 *  отзыв состоит из одной оценки. Это же правило на сервере. */
const MAX_BODY = 2000;

const rating = ref(0);
const bodyText = ref("");
const submitting = ref(false);
const errorMessage = ref("");
const imageBroken = ref(false);
/** Ключ формы: меняется при переходе к следующей позиции, и Vue
 *  пересоздаёт форму — за счёт этого работает затухание. */
const formKey = ref(0);

const { panelRef, scrollRef, shellRef, expanded, dragging, closing, panelStyle,
  requestClose, handleKeydown, resetForOpen, onDragStart, onDragMove, onDragEnd,
  onDragCancel, onListTouchStart, onListTouchMove, onListTouchEnd } =
  useSlidingPanel({
    onClose: () => emit("close"),
    // Высоту считаем по форме: кнопка «Отправить» должна быть видна
    // сразу, без прокрутки.
    autoFitSelector: ".rw-form",
  });

/** Отмена жеста по списку — та же логика, что у закрытия. */
function onListTouchCancel(event: TouchEvent) {
  onListTouchEnd(event);
}

/** Подсказка под звёздами меняется по оценке, как в макете. */
const commentPlaceholder = computed(() => {
  if (rating.value === 0) return "Расскажите о своём опыте…";
  if (rating.value <= 2) return "Что вам не понравилось в товаре?";
  if (rating.value === 3) return "Расскажите о плюсах и минусах товара…";
  return "Что вам понравилось в товаре?";
});

/** Кнопка активна, как только выбрана оценка: текст необязателен. */
const canSubmit = computed(() => rating.value >= 1 && rating.value <= 5);

/** Подпись под полем: просто поясняет, что слова не обязательны. */
const bodyHint = computed(() =>
  bodyText.value.trim().length === 0 ? "Комментарий необязателен" : "Комментарий готов",
);

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  if (!props.orderId || !props.groupId) {
    errorMessage.value = "Не удалось определить заказ для отзыва";
    return;
  }

  submitting.value = true;
  errorMessage.value = "";

  try {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...withTelegramAuthHeaders(),
      },
      body: JSON.stringify({
        order_id: props.orderId,
        group_id: props.groupId,
        order_item_id: props.orderItemId || null,
        rating: rating.value,
        body_text: bodyText.value,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      errorMessage.value = data?.message || "Не удалось отправить отзыв";
      return;
    }

    // Отзыв принят: сообщаем наружу, чтобы родитель перечитал промпт
    // и отдал следующую позицию. Если она есть — форма обновится на
    // месте с затуханием, без промежуточных экранов.
    emit("submitted");
  } catch {
    errorMessage.value = "Не удалось отправить отзыв";
  } finally {
    submitting.value = false;
  }
}

/* Смена позиции при открытой форме: сбрасываем поля и пересоздаём
   форму с затуханием, окно не закрывается. */
watch(
  () => props.title,
  async () => {
    if (!props.open) return;
    rating.value = 0;
    bodyText.value = "";
    errorMessage.value = "";
    imageBroken.value = false;
    formKey.value += 1;
  },
);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    rating.value = 0;
    bodyText.value = "";
    errorMessage.value = "";
    imageBroken.value = false;
    // Новый ключ — форма пересоздаётся с затуханием под новую позицию.
    formKey.value += 1;
    await resetForOpen();
  },
  { immediate: true },
);
</script>

<style scoped>
/* Механика панели — общая с ReviewsFeedPanel (useSlidingPanel). */
.rs-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(26, 29, 39, 0.38);
  backdrop-filter: blur(3px);
}

.rs-shell {
  position: fixed;
  inset: 0;
  z-index: 101;
  pointer-events: none;
}

.rs-panel {
  position: fixed;
  z-index: 101;
  bottom: 0;
  left: 50%;
  width: min(100%, 480px);
  height: 64dvh;
  transform: translate(-50%, 0);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f5f6fa;
  border-radius: 28px 28px 0 0;
  box-shadow: 0 -12px 70px #171c2520;
  color: #17191d;
  font-family: "Montserrat", sans-serif;
  pointer-events: auto;
  isolation: isolate;
  transition: height 0.38s cubic-bezier(0.32, 0.72, 0, 1), transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
  animation: rw-arrive 0.42s cubic-bezier(0.22, 0.78, 0.24, 1) backwards;
}

.rs-panel:focus {
  outline: none;
}

.rs-shell--full .rs-panel {
  height: 94dvh;
}

.rs-panel.rs-dragging {
  transition: none;
}

.rs-shell--closing .rs-panel {
  transform: translate(-50%, 100%);
}

.rs-shell--closing .rs-mask {
  opacity: 0;
}

@keyframes rw-arrive {
  from { transform: translate(-50%, 105%); }
  to { transform: translate(-50%, 0); }
}

.rs-grip {
  height: 27px;
  display: grid;
  place-items: center;
  flex: none;
  background: #fff;
  cursor: grab;
  touch-action: none;
}

.rs-grip:active {
  cursor: grabbing;
}

.rs-grip i {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 8px;
  background: #d7dae1;
}

.rs-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 16px 17px;
  background: #fff;
  cursor: grab;
  touch-action: none;
}

.rs-head h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -0.65px;
}

.rs-head p {
  margin: 5px 0 0;
  font-size: 11px;
  color: #838792;
}

.rs-head-actions {
  display: flex;
  gap: 6px;
}

.rs-icon-button {
  display: grid;
  place-items: center;
  min-width: 40px;
  min-height: 40px;
  border: 0;
  border-radius: 50%;
  background: #f3f4f7;
  color: #5e6570;
  font-size: 23px;
  line-height: 1;
  cursor: pointer;
}

.rs-icon-button:focus-visible {
  outline: 2px solid #d02a23;
  outline-offset: 2px;
}

.rs-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  scroll-padding-top: 14px;
  scroll-padding-bottom: 18px;
}

/* ===== Форма ===== */
.rw-form {
  padding: 18px;
  border-radius: 20px;
  background: #fff;
  font-family: "Montserrat", sans-serif;
}

.rw-product {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.rw-photo {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 58px;
  overflow: hidden;
  border: 1px solid #e8ebf0;
  border-radius: 12px;
  background: #f7f8fa;
  color: #b3bac5;
}

.rw-photo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rw-photo svg {
  width: 29px;
  height: 29px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}

.rw-product strong {
  font-size: 15px;
  font-weight: 600;
}

.rw-product p {
  margin: 5px 0 0;
  font-size: 12px;
  color: #9096a1;
}

.rw-rating {
  min-width: 0;
  margin: 0 0 18px;
  padding: 0;
  border: 0;
}

.rw-rating legend {
  margin-bottom: 9px;
  font-size: 12px;
  font-weight: 600;
}

.rw-stars {
  display: flex;
  justify-content: space-between;
  gap: 3px;
}

.rw-radio {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.rw-star {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  font-size: 40px;
  line-height: 1;
  color: #dfe3ea;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.16s, transform 0.16s;
}

.rw-star:active {
  transform: scale(0.9);
}

.rw-star.rw-filled {
  color: #db2d23;
}

.rw-radio:focus-visible + .rw-star {
  border-radius: 9px;
  outline: 2px solid #d52a21;
  outline-offset: 1px;
}

.rw-comment-label {
  display: block;
  margin-bottom: 9px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.rw-sr-only {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.rw-form textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px;
  /* 16px: при меньшем iOS зумит страницу при фокусе. */
  font-family: inherit;
  font-size: 16px;
  line-height: 1.55;
  color: #333941;
  background: #f7f8fa;
  border: 1px solid #e8ebf0;
  border-radius: 12px;
  resize: vertical;
}

.rw-form textarea::placeholder {
  color: #9298a3;
  opacity: 1;
}

.rw-form textarea:focus {
  outline: 2px solid #1683ef;
  outline-offset: 1px;
}

.rw-note {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
  font-size: 9px;
  line-height: 1.5;
  color: #9298a3;
}

.rw-counter {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.rw-submit {
  width: 100%;
  min-height: 46px;
  margin-top: 19px;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(110deg, #ee3023, #b31e18);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.rw-submit:active:not(:disabled) {
  opacity: 0.9;
  transform: scale(0.98);
}

.rw-submit:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Переход к следующей позиции: старая форма затухает, новая
   проявляется на её месте — окно при этом остаётся открытым. */
.rw-swap-enter-active,
.rw-swap-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.rw-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.rw-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .rw-swap-enter-active,
  .rw-swap-leave-active {
    transition: none;
  }
}

.rw-submit-error {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #c5221c;
  text-align: center;
}

.rs-fade-enter-active,
.rs-fade-leave-active {
  transition: opacity 0.32s;
}

.rs-fade-enter-from,
.rs-fade-leave-to {
  opacity: 0;
}

@media (max-width: 350px) {
  .rw-form {
    padding: 15px;
  }

  .rw-star {
    width: 42px;
    height: 44px;
    font-size: 35px;
  }

  .rw-note {
    font-size: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rs-panel,
  .rs-fade-enter-active,
  .rs-fade-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
