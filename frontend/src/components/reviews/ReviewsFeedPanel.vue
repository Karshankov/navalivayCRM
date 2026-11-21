<template>
  <Teleport to="body">
    <Transition name="rs-fade">
      <div v-if="open" class="rs-mask" aria-hidden="true" @click="requestClose" />
    </Transition>

    <section
      v-if="open"
      ref="shellRef"
      class="rs-shell"
      :class="{ 'rs-shell--full': expanded, 'rs-shell--closing': closing }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rs-panel-title"
    >
      <div
        ref="panelRef"
        class="rs-panel"
        :class="{ 'rs-dragging': dragging }"
        :style="panelStyle"
        tabindex="-1"
        @keydown="handleKeydown"
      >
        <div class="rs-grip" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragCancel">
          <i />
        </div>

        <header class="rs-head" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragCancel">
          <div>
            <h2 id="rs-panel-title">Отзывы клиентов</h2>
            <p>{{ props.heading || "О товарах и их качестве" }}</p>
          </div>
          <div class="rs-head-actions">
            <button type="button" class="rs-icon-button rs-close" aria-label="Закрыть отзывы" @click="requestClose">
              ×
            </button>
          </div>
        </header>

        <div ref="scrollRef" class="rs-scroll">
          <div v-if="isLoading" class="rs-state">
            <p>Загружаем отзывы…</p>
          </div>

          <div v-else-if="errorMessage" class="rs-state">
            <p>{{ errorMessage }}</p>
            <button
              type="button"
              class="rs-reset"
              :disabled="isLoading"
              @click="load"
            >
              {{ isLoading ? "Загружаем…" : "Повторить" }}
            </button>
          </div>

          <template v-else>
            <!-- Блок про кэшбэк за отзывы: визуальная часть из макета.
                 Условия начисления не подключены. -->
            <section class="rs-about">
              <img
                class="rs-about-coin"
                src="/shortcuts/reviews-coin.png"
                width="90"
                height="90"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <div class="rs-about-copy">
                <h3>
                  Оставляйте отзывы.<br />
                  <span>Получайте кэшбэк.</span>
                </h3>
                <p>
                  Делитесь реальными впечатлениями: что понравилось, а что можно
                  улучшить. Ваш опыт поможет другим с выбором.
                </p>
                <small>Кэшбэк за отзыв с любой оценкой</small>
              </div>
            </section>

            <div class="rs-tools">
              <strong>Все отзывы · {{ reviewCount }}</strong>
            </div>

            <div v-if="!items.length" class="rs-empty">
              <strong>Пока нет отзывов</strong>
              <p>Отзывы появятся здесь, как только покупатели ими поделятся.</p>
            </div>

            <!-- v-for с v-else на одном узле Vue не поддерживает: отзывы
                 просто не отрисовывались. Отдельный блок решает это. -->
            <template v-else>
              <article
                v-for="review in items"
                :key="review.id"
                class="rs-review"
              >
              <!-- Аватар клиента: фото из Telegram, а если его нет или
                   иконка сломалась — первая буква имени. -->
              <header class="rs-person">
                <span class="rs-avatar">
                  <img
                    v-if="reviewerPhoto(review) && !brokenAvatars.has(review.id)"
                    :src="reviewerPhoto(review)!"
                    :alt="review.reviewer.display_name"
                    @error="markAvatarBroken(review.id)"
                  />
                  <template v-else>{{ review.reviewer.display_name.charAt(0) }}</template>
                </span>
                <div class="rs-author">
                  <strong>{{ review.reviewer.display_name }}</strong>
                  <time>{{ formatDate(review.approved_at || review.created_at) }}</time>
                </div>
                <div class="rs-stars" :aria-label="`${review.rating} из 5`">
                  <span v-for="star in 5" :key="star" :class="{ off: star > review.rating }">★</span>
                </div>
              </header>

              <div v-if="productLabel(review)" class="rs-product">
                <!-- Фото товара: у большинства позиций картинки нет,
                     поэтому показываем аккуратную заглушку. -->
                <span class="rs-photo">
                  <img
                    v-if="review.product_image_url && !brokenProducts.has(review.id)"
                    :src="review.product_image_url"
                    :alt="productLabel(review)"
                    @error="markProductBroken(review.id)"
                  />
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m4 18 6-6 4 4 3-3 4 5" />
                  </svg>
                </span>
                <div>
                  <div class="rs-product-name">{{ productLabel(review) }}</div>
                </div>
              </div>

                <p>{{ review.body_text }}</p>
              </article>
            </template>

            <button
              v-if="hasMore"
              type="button"
              class="rs-more"
              :disabled="isLoadingMore"
              @click="loadMore"
            >
              {{ isLoadingMore ? "Загружаем…" : "Показать ещё" }}
            </button>

            <p v-if="items.length && !hasMore" class="rs-end">Это все отзывы</p>
          </template>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useReviewsFeed, type ReviewsFeedItem } from "@/composables/useReviewsFeed";

/** Отзывы, у которых иконка автора или фото товара не загрузились:
 *  показываем заглушку вместо «сломанной» картинки. */
const brokenAvatars = ref(new Set<string>());
const brokenProducts = ref(new Set<string>());

function reviewerPhoto(review: ReviewsFeedItem): string | null {
  return review.reviewer.photo_url || null;
}

function markAvatarBroken(id: string) {
  brokenAvatars.value = new Set(brokenAvatars.value).add(id);
}

function markProductBroken(id: string) {
  brokenProducts.value = new Set(brokenProducts.value).add(id);
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Линейка для карточки товара. Без неё — общий поток отзывов. */
    groupId?: string | null;
    /** Заголовок панели: в карточке товара называем линейку. */
    heading?: string;
  }>(),
  { groupId: null, heading: "" },
);
const emit = defineEmits<{ (e: "close"): void }>();

const {
  items,
  reviewCount,
  isLoading,
  isLoadingMore,
  errorMessage,
  hasMore,
  load,
  loadMore,
} = useReviewsFeed({ groupId: () => props.groupId });

const shellRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

/** Два устойчивых положения панели: малое и полное (как в макете). */
const SMALL_RATIO = 0.64;
const LARGE_RATIO = 0.94;
/** Ниже этой доли экрана панель закрывается сама. */
const CLOSE_RATIO = 0.43;

const expanded = ref(false);
const dragging = ref(false);
const closing = ref(false);
const dragHeight = ref<number | null>(null);
const viewportHeight = ref(typeof window === "undefined" ? 800 : window.innerHeight);

const smallHeight = () => Math.round(viewportHeight.value * SMALL_RATIO);
const largeHeight = () => Math.round(viewportHeight.value * LARGE_RATIO);

const panelStyle = computed(() =>
  dragHeight.value === null ? undefined : { height: `${dragHeight.value}px` },
);

/** «PODONKI PODGON — Вишня»: товар и, если есть, вкус. */
function productLabel(review: ReviewsFeedItem): string {
  const group = (review.group_name || "").trim();
  const variant = (review.purchased_variant_name || "").trim();
  if (group && variant && group !== variant) return `${group} — ${variant}`;
  return group || variant || "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

/* ===== Перетаскивание панели =====
   Механика повторяет макет: тянем за полоску или шапку, высота идёт
   за пальцем; отпускание решает — закрыть, развернуть или вернуться
   к ближайшему положению. Жест вниз по списку работает только когда
   список прокручен в самый верх. */
interface DragState {
  startY: number;
  startHeight: number;
  lastY: number;
  lastTime: number;
  velocity: number;
}

let drag: DragState | null = null;
let listTouch: { y: number; atTop: boolean } | null = null;

function beginDrag(clientY: number) {
  // Высоту берём из состояния панели, а не из DOM: getBoundingClientRect
  // может вернуть 0 (скрытая панель, первый кадр, тестовая среда), и
  // жест тогда считается от нуля — панель прыгает к минимуму.
  const height = panelRef.value?.getBoundingClientRect().height;
  const startHeight =
    height && height > 0 ? height : expanded.value ? largeHeight() : smallHeight();
  drag = {
    startY: clientY,
    startHeight,
    lastY: clientY,
    lastTime: performance.now(),
    velocity: 0,
  };
  dragging.value = true;
}

function moveDrag(clientY: number) {
  if (!drag) return;
  const now = performance.now();
  const dt = now - drag.lastTime;
  if (dt > 0) {
    drag.velocity = (clientY - drag.lastY) / dt;
    drag.lastTime = now;
    drag.lastY = clientY;
  }
  const next = drag.startHeight - (clientY - drag.startY);
  dragHeight.value = Math.max(120, Math.min(largeHeight(), next));
}

function endDrag(clientY: number, cancel = false) {
  if (!drag) return;
  const state = drag;
  // Высоту запоминаем ДО сброса: после него dragHeight уже null.
  const height = dragHeight.value ?? state.startHeight;
  drag = null;
  dragging.value = false;
  dragHeight.value = null;

  // Отмена жеста (pointercancel): панель возвращается к прежнему
  // положению, решение не принимаем.
  if (cancel) return;

  const dy = clientY - state.startY;
  const velocity = performance.now() - state.lastTime < 100 ? state.velocity : 0;

  // Уронили слишком низко — закрываем.
  if (height < viewportHeight.value * CLOSE_RATIO) {
    requestClose();
    return;
  }
  // Быстрый смах вверх разворачивает, быстрый вниз — сворачивает.
  if (dy < -30 && velocity < -0.4) {
    expanded.value = true;
    return;
  }
  if (dy > 30 && velocity > 0.4) {
    expanded.value = false;
    return;
  }
  // Иначе — к ближайшему устойчивому положению.
  expanded.value = height > (smallHeight() + largeHeight()) / 2;
}

function onDragStart(event: PointerEvent) {
  if ((event.target as HTMLElement).closest("button, a, select")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  beginDrag(event.clientY);
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onDragMove(event: PointerEvent) {
  if (drag) moveDrag(event.clientY);
}

function onDragEnd(event: PointerEvent) {
  if (drag) endDrag(event.clientY);
}

function onDragCancel(event: PointerEvent) {
  if (drag) endDrag(event.clientY, true);
}

/* Жест по списку: вверх разворачивает панель, вниз на самом верху —
   закрывает. Иначе список прокручивается как обычно. */
function onListTouchStart(event: TouchEvent) {
  const scroller = scrollRef.value;
  if (!scroller || event.touches.length !== 1) {
    listTouch = null;
    return;
  }
  if ((event.target as HTMLElement).closest("button, a, select, input, textarea, label")) {
    listTouch = null;
    return;
  }
  listTouch = { y: event.touches[0].clientY, atTop: scroller.scrollTop <= 0 };
}

function onListTouchMove(event: TouchEvent) {
  if (!listTouch || event.touches.length !== 1) return;
  const y = event.touches[0].clientY;
  const dy = y - listTouch.y;
  if (!drag && Math.abs(dy) > 5 && ((!expanded.value && dy < 0) || (listTouch.atTop && dy > 0))) {
    beginDrag(listTouch.y);
  }
  if (drag) {
    event.preventDefault();
    moveDrag(y);
  }
}

function onListTouchEnd(event: TouchEvent) {
  if (drag) endDrag(event.changedTouches[0].clientY);
  listTouch = null;
}

/* ===== Закрытие =====
   Панель уезжает вниз, и только потом сообщаем наружу: иначе она
   исчезала бы мгновенно, без анимации. */
let closeTimer: ReturnType<typeof setTimeout> | 0 = 0;

function requestClose() {
  if (closing.value) return;
  closing.value = true;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closing.value = false;
    expanded.value = false;
    emit("close");
  }, 380);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== "Tab") return;
  // Фокус-ловушка: панель модальная, фокус не должен уходить за неё.
  const panel = panelRef.value;
  if (!panel) return;
  const focusable = [
    ...panel.querySelectorAll<HTMLElement>("a[href], button, select"),
  ].filter((node) => !node.hidden && node.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncViewport() {
  viewportHeight.value = window.innerHeight;
}

/** Подготовка к показу: сброс положения, загрузка данных, фокус. */
async function handleOpened() {
  expanded.value = false;
  closing.value = false;
  dragHeight.value = null;
  await nextTick();
  await load();
  await nextTick();
  panelRef.value?.focus({ preventScroll: true });
}

watch(
  [() => props.open, () => props.groupId],
  ([isOpen], [wasOpen, wasGroup]) => {
    if (!isOpen) return;
    // Загружаем при открытии и при смене линейки: иначе в карточке
    // товара показались бы отзывы прошлой линейки.
    if (!wasOpen || wasGroup !== props.groupId) void handleOpened();
  },
  // immediate: панель может быть смонтирована уже открытой — без этого
  // данные не загрузились бы вовсе, и экран остался бы пустым.
  { immediate: true },
);

watch(expanded, () => {
  dragHeight.value = null;
});

if (typeof window !== "undefined") {
  window.addEventListener("resize", syncViewport);
  window.addEventListener("orientationchange", syncViewport);
}

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
  window.removeEventListener("resize", syncViewport);
  window.removeEventListener("orientationchange", syncViewport);
});
</script>

<style scoped>
/* Механика панели перенесена из navalivay-reviews-final: маска на весь
   экран, панель снизу с двумя устойчивыми положениями, перетаскивание
   за полоску и шапку, уезд вниз при закрытии. */
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
  animation: rs-arrive 0.42s cubic-bezier(0.22, 0.78, 0.24, 1) backwards;
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

@keyframes rs-arrive {
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
}

.rs-state {
  padding: 30px 16px;
  text-align: center;
  color: #7d8490;
  font-size: 13px;
}

/* Блок «Оставляйте отзывы. Получайте кэшбэк.» — из макета. */
.rs-about {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 12px;
  padding: 19px 15px;
  border-radius: 20px;
  background: #fff;
}

.rs-about-coin {
  display: block;
  flex: none;
  width: 90px;
  height: 90px;
  object-fit: contain;
  filter: drop-shadow(0 5px 7px #1269ba14);
}

.rs-about-copy {
  flex: 1;
  min-width: 0;
}

.rs-about h3 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.45;
  letter-spacing: -0.4px;
}

.rs-about h3 span {
  color: #1683ef;
}

.rs-about p {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: #777e89;
}

.rs-about small {
  display: block;
  margin-top: 9px;
  font-size: 9px;
  line-height: 1.5;
  color: #989da6;
}

.rs-stars {
  display: flex;
  gap: 2px;
  color: #d72a22;
  white-space: nowrap;
}

.rs-stars .off {
  color: #dce0e7;
}

.rs-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 18px 2px 11px;
}

.rs-tools strong {
  font-size: 13px;
  font-weight: 600;
}

.rs-review {
  margin: 0 0 10px;
  padding: 16px;
  border-radius: 19px;
  background: #fff;
}

.rs-person {
  display: flex;
  align-items: center;
  gap: 9px;
}

.rs-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  overflow: hidden;
  border-radius: 50%;
  background: #f1f2f6;
  color: #707784;
  font-size: 12px;
  font-weight: 600;
}

.rs-avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rs-author {
  flex: 1;
  min-width: 0;
}

.rs-author strong {
  display: block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.rs-author time {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: #9297a1;
}

.rs-person .rs-stars {
  font-size: 14px;
}

.rs-product {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 13px 0 11px;
  padding: 9px;
  border-radius: 11px;
  background: #f7f8fa;
}

.rs-photo {
  display: grid;
  place-items: center;
  flex: none;
  width: 29px;
  height: 32px;
  overflow: hidden;
  border: 1px solid #e1e4eb;
  border-radius: 7px;
  background: #fff;
  color: #adb3bf;
}

.rs-photo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rs-photo svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}

.rs-product-name {
  font-size: 11px;
  font-weight: 550;
  line-height: 1.4;
}

.rs-review p {
  margin: 0;
  font-size: 12px;
  line-height: 1.75;
  letter-spacing: -0.1px;
  color: #454a54;
}

/* «Показать ещё» — во всю ширину, красная заливка в стиле проекта
   (тот же градиент и радиус, что у .submit-button в оформлении). */
.rs-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  margin-top: 14px;
  padding: 12px 18px;
  border: 0;
  border-radius: var(--customer-radius-action, 18px);
  background: var(--customer-red-gradient);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 18px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.rs-more:active:not(:disabled) {
  opacity: 0.9;
  transform: scale(0.98);
}

.rs-more:focus-visible {
  outline: 2px solid #d02a23;
  outline-offset: 3px;
}

.rs-more:disabled {
  opacity: 0.6;
  cursor: wait;
}

.rs-empty {
  padding: 30px 16px;
  border-radius: 18px;
  background: #fff;
  text-align: center;
}

.rs-empty strong {
  font-size: 15px;
}

.rs-empty p {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #7d8490;
}

.rs-reset {
  margin-top: 14px;
  padding: 11px 17px;
  border: 0;
  border-radius: 11px;
  background: #f3f4f7;
  font-size: 12px;
  cursor: pointer;
}

/* На время повтора кнопка неактивна и не даёт запустить второй запрос. */
.rs-reset:disabled {
  opacity: 0.6;
  cursor: wait;
}

.rs-end {
  margin: 20px 0 0;
  text-align: center;
  font-size: 10px;
  line-height: 1.5;
  color: #9298a4;
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
  .rs-about {
    gap: 10px;
    padding: 16px 12px;
  }

  .rs-about-coin {
    width: 70px;
    height: 70px;
  }

  .rs-about h3 {
    font-size: 13px;
  }

  .rs-about p {
    font-size: 10px;
  }

  .rs-scroll {
    padding-inline: 12px;
  }

  .rs-review {
    padding: 14px;
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
