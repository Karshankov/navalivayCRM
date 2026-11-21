<template>
  <div class="min-h-screen customer-page-surface">
    <SmokeParticles :count="4" area="full" />

    <!-- Вход в профиль из navalivay-profile-comment.html: первая строка
         экрана, выше баннера. В обычном потоке — при прокрутке уходит
         вместе с контентом, ничего не закреплено. Открывает тот же
         /profile, что и прежняя кнопка в верхней панели. -->
    <div v-if="!wholesaleStore.isWholesale" class="profile-entry-section">
      <button
        type="button"
        class="nvl-profile-entry"
        aria-label="Открыть мой профиль"
        @click="openProfile"
      >
        <span class="nvl-profile-entry__avatar" aria-hidden="true">
          <img v-if="userStore.photoUrl" :src="userStore.photoUrl" alt="" />
          <template v-else>{{ profileInitial }}</template>
        </span>
        <span class="nvl-profile-entry__copy">
          <strong class="nvl-profile-entry__name">{{ userStore.displayName }}</strong>
          <span class="nvl-profile-entry__subtitle">Мои заказы и настройки</span>
        </span>
        <span class="nvl-profile-entry__action">Профиль ›</span>
      </button>
    </div>

    <!-- Баннер -->
    <div v-if="!wholesaleStore.isWholesale && catalogStore.banners.length" class="mb-0 relative banner-wrapper">
      <div class="banner-container relative">
        <BannerCarousel
          :banners="catalogStore.banners"
          :is-loading="catalogStore.isLoading"
          :auto-play="true"
          :auto-play-interval="5000"
        />
      </div>
    </div>

    <div class="main-content-wrapper">
      <!-- Плитки «Избранное» / «Часто покупают» над категориями -->
      <section
        v-if="!wholesaleStore.isWholesale"
        class="home-shortcuts-section"
        aria-label="Быстрые разделы"
      >
        <HomeShortcuts />
      </section>

      <section v-if="wholesaleStore.isWholesale" class="px-4 pt-4">
        <div class="wholesale-mode-card">
          <p class="wholesale-mode-kicker">Оптовый режим</p>
          <p class="wholesale-mode-title">
            {{ wholesaleStore.wholesaleLabel }}
          </p>
          <p class="wholesale-mode-text">
            <template v-if="wholesaleStore.effectiveMinQuantity">
              Минимальное количество заказа -
              {{ wholesaleStore.effectiveMinQuantity }}
              {{ pluralPositions(wholesaleStore.effectiveMinQuantity) }}<span
                v-if="wholesaleStore.minOverride"
              > · персональный минимум</span>.
              <template v-if="remainingWholesaleMinimum > 0">
                Сейчас не хватает {{ remainingWholesaleMinimum }}
                {{ genitivePositions(remainingWholesaleMinimum) }}.
              </template>
              <template v-else>
                Минимум уже выполнен.
              </template>
            </template>
            <template v-else>
              Минимальная сумма заказа - {{ wholesaleStore.minOrderAmount.toFixed(0) }} BYN.
              <template v-if="remainingWholesaleMinimum > 0">
                Сейчас не хватает {{ remainingWholesaleMinimum.toFixed(2) }} BYN.
              </template>
              <template v-else>
                Минимум уже выполнен.
              </template>
            </template>
          </p>
        </div>
      </section>

      <section v-if="activeOrder && !cartStore.editingOrderId" class="active-order-section">
        <button class="active-order-banner" @click="router.push('/my-order')">
          <div class="active-order-copy">
            <span class="active-order-kicker">Активный заказ</span>
            <strong class="active-order-title">Заказ уже оформлен</strong>
            <span class="active-order-text">
              {{
                activeOrder.status === "in_progress"
                  ? "Он уже собран. Откройте заказ, чтобы посмотреть статус или отменить его."
                  : "Откройте заказ, чтобы изменить состав или посмотреть статус."
              }}
            </span>
          </div>
          <span class="active-order-action">Открыть</span>
        </button>
      </section>

      <!-- «Наш ассортимент» из демо: широкая витрина-картинка с
           3D-наклоном по касанию, дымом и дышащим LED; подпись
           снизу. Ведёт в жидкости (раздел по умолчанию). -->
      <section class="assortment-section" aria-label="Наш ассортимент">
        <button
          ref="assortmentRef"
          class="assortment"
          type="button"
          :style="{ '--tilt-x': tiltX, '--tilt-y': tiltY }"
          @click="openAssortment"
          @pointermove="handleAssortmentTilt"
          @pointerleave="resetAssortmentTilt"
        >
          <span class="assortment-picture">
            <span class="assortment-stage">
              <img
                class="assortment-art"
                src="/shortcuts/assortment-art.png"
                alt="Товары из шести категорий: жидкости, расходники, устройства, одноразки, снюс и кальянка"
                loading="lazy"
                decoding="async"
              />
              <span class="hose-smoke" aria-hidden="true">
                <i></i><i></i><i></i><i></i><i></i>
              </span>
              <span class="pod-led" aria-hidden="true"></span>
            </span>
          </span>
          <span class="assortment__label">Наш ассортимент</span>
        </button>
      </section>

      <!-- Плитка отзывов из navalivay-reviews-3.html: сразу под
           подписью «Наш ассортимент». Оценка и количество — реальные,
           с сервера (общий поток одобренных отзывов по всем товарам).
           Нажатие открывает панель со списком отзывов. -->
      <section class="review-entry" aria-label="Нам доверяют">
        <button
          type="button"
          class="review-entry__wide"
          aria-label="Открыть отзывы клиентов"
          @click="reviewsPanelOpen = true"
        >
          <span class="review-entry__art-wrap">
            <img
              class="review-entry__art"
              src="/shortcuts/reviews-art.png"
              alt=""
              width="1280"
              height="1280"
              loading="lazy"
              decoding="async"
            />
          </span>
          <span class="review-entry__copy">
            <h2 class="review-entry__title">Нам доверяют</h2>
            <span class="review-entry__score">
              <span class="review-entry__star" aria-hidden="true">★</span>
              {{ reviewsAverageLabel }}
              <span class="review-entry__sub">{{ reviewsCountLabel }}</span>
            </span>
            <!-- Вознаграждение за отзывы: визуальный пример из макета.
                 Логику начисления подключим отдельно. -->
            <span class="review-reward">
              <span class="reward-line">
                <span>Оставьте ещё <b>10 отзывов</b></span>
                <span class="reward-promise">
                  Начислим
                  <span class="reward-value">
                    3 BYN кэшбэка
                    <img
                      class="reward-coin"
                      src="/shortcuts/reviews-coin.png"
                      alt=""
                      width="19"
                      height="19"
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                </span>
              </span>
            </span>
          </span>
          <span class="review-entry__arrow" aria-hidden="true">›</span>
        </button>

        <!-- Строка «Как вам …?»: показывается, только когда есть
             покупка без отзыва. Оценил — сервер перестаёт отдавать
             промпт, и строка исчезает вместе с возможностью нажать. -->
        <button
          v-if="reviewPrompt"
          type="button"
          class="quick-trigger"
          :aria-label="`Оценить покупку: ${reviewPromptTitle}`"
          @click="openReviewForm"
        >
          <span class="quick-trigger__photo" aria-hidden="true">
            <img
              v-if="reviewPromptImage && !reviewPromptImageBroken"
              :src="reviewPromptImage"
              alt=""
              @error="reviewPromptImageBroken = true"
            />
            <svg v-else viewBox="0 0 48 48">
              <rect x="8" y="7" width="32" height="34" rx="7" />
              <circle cx="18" cy="18" r="3" />
              <path d="m9 33 10-9 8 7 5-5 7 8" />
            </svg>
          </span>
          <span class="quick-trigger__copy">
            <span class="quick-trigger__line">Как вам {{ reviewPromptTitle }}?</span>
            <span class="animated-stars" aria-hidden="true">
              <i>★</i><i>★</i><i>★</i><i>★</i><i>★</i>
            </span>
          </span>
          <span class="quick-trigger__arrow" aria-hidden="true">›</span>
        </button>
      </section>

      <!-- Панель со списком отзывов: выезжает снизу, тянется за полоску
           и шапку, закрывается по маске, крестику, Escape и свайпу вниз. -->
      <ReviewsFeedPanel
        :open="reviewsPanelOpen"
        @close="reviewsPanelOpen = false"
      />

      <!-- Форма оценки покупки: открывается из строки «Как вам …?». -->
      <ReviewFormPanel
        :open="reviewFormOpen"
        :order-id="reviewPrompt?.order_id ?? null"
        :group-id="reviewPrompt?.group_id ?? null"
        :title="reviewPromptTitle"
        :image-url="reviewPromptImage"
        :has-next="pendingReviewCount > 1"
        :pending-count="pendingReviewCount"
        @close="reviewFormOpen = false"
        @submitted="handleReviewSubmitted"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useCatalogStore } from "@/stores/catalog";
import { useCartStore } from "@/stores/cart";
import { useWholesaleStore } from "@/stores/wholesale";
import { useFavoritesStore } from "@/stores/favorites";
import { useUserStore } from "@/stores/user";
import { useReviewsFeed } from "@/composables/useReviewsFeed";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";
import ReviewsFeedPanel from "@/components/reviews/ReviewsFeedPanel.vue";
import ReviewFormPanel from "@/components/reviews/ReviewFormPanel.vue";
import HomeShortcuts from "@/components/HomeShortcuts.vue";
import SmokeParticles from "@/components/SmokeParticles.vue";
import BannerCarousel from "@/components/BannerCarousel.vue";
import {
  fetchMyActiveOrder,
  getTelegramIdentity,
  type CustomerActiveOrder,
} from "@/utils/customerOrders";

const catalogStore = useCatalogStore();
const cartStore = useCartStore();
const wholesaleStore = useWholesaleStore();
const favoritesStore = useFavoritesStore();
const userStore = useUserStore();
const router = useRouter();
const activeOrder = ref<CustomerActiveOrder | null>(null);

/** Плитка отзывов и панель со списком: оценка и количество приходят
 *  с сервера, отдельного счётчика на клиенте нет. */
const {
  averageLabel: reviewsAverageLabel,
  countLabel: reviewsCountLabel,
  load: loadReviewsFeed,
} = useReviewsFeed();
const reviewsPanelOpen = ref(false);

/** Покупка без отзыва: строка «Как вам …?» показывается только при ней.
 *  Сервер сам решает, есть ли что оценивать (getReviewPromptForCustomer),
 *  поэтому после отправки отзыва промпт пропадает и строка исчезает. */
interface ReviewPrompt {
  show: boolean;
  reason: string;
  order_id?: string;
  group_id?: string;
  group_name?: string | null;
  purchased_variant_name?: string | null;
  pending_review_count?: number;
}

const reviewPrompt = ref<ReviewPrompt | null>(null);
const reviewPromptImageBroken = ref(false);
const reviewFormOpen = ref(false);

/**
 * Название товара в строке. В макете это просто название линейки
 * («Как вам Catsville?»), поэтому основой берём группу.
 * Вкус добавляем, только когда он несёт смысл: у устройств и
 * картриджей variant_name — цвет или сопротивление («Black»,
 * «Xros 0.6 Ω»), и в названии он лишний.
 */
const reviewPromptTitle = computed(() => {
  const prompt = reviewPrompt.value;
  if (!prompt) return "";
  const group = (prompt.group_name || "").trim();
  const variant = (prompt.purchased_variant_name || "").trim();

  if (!group) return variant;
  if (!variant || variant === group) return group;

  // Цвет, сопротивление и прочие технические пометки не показываем.
  const technical = /[Ωω]|\d+\s*(мл|ml|мг|mg|w|вт|mm|мм)|^(black|white|blue|red|green|grey|gray|purple|pink|silver|gold|space|matte|classic|dark|light|teal|rose|pastel|flowing|carbon|mist|ss|titanium|stone|арбузный|земляничный|виноградный|персиковый|клубничный|вишнёвый|вишневый|манго|яблочный|лимонный)/i;
  if (technical.test(variant)) return group;

  return `${group} — ${variant}`;
});

/** Обложка группы по тому же адресу, что и в списке отзывов. */
const reviewPromptImage = computed(() => {
  const groupId = reviewPrompt.value?.group_id;
  return groupId ? `/api/category-groups/${encodeURIComponent(groupId)}/cover` : null;
});

async function loadReviewPrompt() {
  try {
    const response = await fetch("/api/reviews/prompt", {
      headers: withTelegramAuthHeaders(),
    });
    if (!response.ok) {
      reviewPrompt.value = null;
      return;
    }
    const data = (await response.json()) as ReviewPrompt;
    reviewPrompt.value = data.show ? data : null;
    reviewPromptImageBroken.value = false;
  } catch {
    reviewPrompt.value = null;
  }
}

function openReviewForm() {
  if (!reviewPrompt.value) return;
  reviewFormOpen.value = true;
}

/** Сколько покупок ещё ждёт оценки (с сервера). */
const pendingReviewCount = computed(() => Number(reviewPrompt.value?.pending_review_count || 0));

/** Отзыв отправлен: перечитываем промпт. Окно не закрываем — если
 *  есть следующая позиция, форма обновится на месте с затуханием.
 *  Если покупок больше нет, промпт придёт пустой, строка исчезнет,
 *  и окно закроется. */
async function handleReviewSubmitted() {
  await loadReviewPrompt();
  if (!reviewPrompt.value) {
    reviewFormOpen.value = false;
  }
}

/** Переход в профиль — тот же маршрут, что был у кнопки в верхней
 *  панели (goToProfile в TopCartBar.vue). Новый экран не заводим. */
function openProfile() {
  router.push("/profile");
}

/** Инициал для аватара, когда фото нет: первая буква имени, как «К»
 *  в макете. Пусто — если имя ещё не загрузилось. */
const profileInitial = computed(() => {
  const name = userStore.displayName?.trim() ?? "";
  return name ? name.charAt(0).toUpperCase() : "";
});

const remainingWholesaleMinimum = computed(() =>
  wholesaleStore.remainingToMinimum(cartStore.countableWholesaleUnits, cartStore.totalAmount),
);

function pluralPositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "позиции";
  return "позиций";
}

// «Не хватает N …» — родительный падеж.
function genitivePositions(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиции";
  return "позиций";
}

/** «Наш ассортимент» всегда открывается в жидкости — раздел по
 *  умолчанию (slug реальной категории каталога); переключение
 *  категорий внутри — быстрая навигация. */
function openAssortment() {
  router.push({ name: "category", params: { slug: "zhidkosti" } });
}

/* ===== 3D-наклон витрины «Наш ассортимент» (по демо) =====
   Только для устройств с мышью (hover + fine pointer): телефон
   наклон по касанию не даёт, там работает пресс-анимация. */
const assortmentRef = ref<HTMLElement | null>(null);
const tiltX = ref("0deg");
const tiltY = ref("0deg");

const canTilt =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function handleAssortmentTilt(event: PointerEvent) {
  if (!canTilt || !assortmentRef.value) return;
  const rect = assortmentRef.value.getBoundingClientRect();
  tiltX.value = `${((event.clientX - rect.left) / rect.width - 0.5) * 5}deg`;
  tiltY.value = `${-((event.clientY - rect.top) / rect.height - 0.5) * 3}deg`;
}

function resetAssortmentTilt() {
  tiltX.value = "0deg";
  tiltY.value = "0deg";
}

async function refreshHomeState() {
  await catalogStore.initialize();

  if (!cartStore.editingOrderId) {
    try {
      activeOrder.value = await fetchMyActiveOrder(getTelegramIdentity());
    } catch (error) {
      activeOrder.value = null;
      console.warn("[Home] Failed to fetch active order", error);
    }
  } else {
    activeOrder.value = null;
  }
}

onMounted(async () => {
  await refreshHomeState();

  // Оценка и количество отзывов на плитке: тянем сразу, чтобы числа
  // не появлялись позже остального экрана.
  void loadReviewsFeed();

  // Строка «Как вам …?»: сервер решает, есть ли покупка без отзыва.
  void loadReviewPrompt();

  // Избранное грузим один раз за сессию: сердечки и страница берут из стора.
  if (!favoritesStore.isLoaded) {
    void favoritesStore.fetchFavorites();
  }

  // Персональный минимум мог смениться админом среди сессии.
  if (wholesaleStore.isWholesale) {
    void wholesaleStore.refreshEffectiveMinimum();
  }

  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
  }
});
</script>

<style scoped>
/* ===== Плитка отзывов (navalivay-reviews-3.html) =====
   Перенесены .review-entry, .quick-trigger, .animated-stars и их
   финальные значения из макета: размеры, шрифт Montserrat и
   анимация звёзд. Интерактив (переход, модалка, отправка) не
   переносился — это только визуальная часть. */
.review-entry {
  margin-top: 16px;
  overflow: hidden;
  border-radius: 21px;
  background: var(--customer-surface, #ffffff);
}

.review-entry__wide {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Кнопка обязана занимать всю ширину карточки: без width она
     сжималась по содержимому, и стрелка вставала не под стрелкой
     нижней строки, а сразу после текста. */
  width: 100%;
  box-sizing: border-box;
  /* 125px — высота из макета для варианта с блоком вознаграждения;
     с прежними 98px текст вознаграждения сжимался. */
  min-height: 125px;
  padding: 7px 12px 7px 9px;
}

.review-entry__art-wrap {
  flex: none;
}

.review-entry__art {
  display: block;
  width: 80px;
  height: 80px;
  object-fit: contain;
}

.review-entry__copy {
  flex: 1;
  min-width: 0;
  font-family: "Montserrat", sans-serif;
}

.review-entry__title {
  /* text-align: left обязателен: h2 наследует центрирование от
     кнопки, и при её полной ширине заголовок уезжал в середину. */
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  color: #101114;
}

.review-entry__score {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 28px;
  font-weight: 650;
  line-height: 1;
  /* Разрядка снята: с -0.6px звёздочка съезжала влево и не совпадала
     с началом заголовка и строки вознаграждения. */
  color: #17191d;
}

.review-entry__star {
  font-family: Arial, sans-serif;
  font-size: 28px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0;
  color: #d42a20;
}

.review-entry__sub {
  align-self: center;
  margin: 0 0 0 1px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.25;
  color: #626873;
}

/* ===== Вознаграждение за отзывы =====
   Перенесено из макета: «Оставьте ещё N отзывов» и обещание кэшбэка
   с иконкой монеты. Пока это визуальный пример — начисление не
   подключено, числа статичны, как в макете. */
.review-reward {
  display: block;
  margin-top: 9px;
}

.review-reward .reward-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  font-size: 10px;
  line-height: 1.45;
  /* Разрядка снята: с -0.2px строка «Оставьте ещё» начиналась левее
     заголовка и блок читался со сбитым левым краем. */
  color: #818691;
}

.reward-line b {
  font-weight: 600;
  color: #555b65;
}

.reward-promise {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #818691;
}

.reward-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  white-space: nowrap;
  color: #1683ef;
}

.reward-coin {
  display: block;
  flex: none;
  align-self: center;
  width: 19px;
  height: 19px;
  margin: 0;
  object-fit: contain;
  transform: translateY(-1px);
}

.review-entry__arrow {
  flex: none;
  /* Прижата к правому краю строки — на одной вертикали со стрелкой
     нижнего блока «Как вам …». */
  margin-left: auto;
  font-size: 28px;
  line-height: 1;
  color: #656b75;
}

/* Нижняя строка «Как вам …?» со звёздами. */
.quick-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Кнопка обязана занимать всю ширину карточки: без width она
     сжималась по содержимому, и стрелка вставала сразу за текстом,
     а не у правого края. */
  width: 100%;
  box-sizing: border-box;
  min-height: 70px;
  padding: 12px;
  border: 0;
  border-top: 1px solid #f0f1f5;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
}

.quick-trigger:active {
  background: #fafbfc;
}

.quick-trigger:focus-visible {
  outline: 2px solid #d02a23;
  outline-offset: -2px;
}

.quick-trigger__photo {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 39px;
  border: 1px solid #e9ebf0;
  border-radius: 9px;
  background: #f8f9fb;
  color: #c0c5ce;
}

.quick-trigger__photo svg {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.quick-trigger__photo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.quick-trigger__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.quick-trigger__line {
  font-family: "Montserrat", sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.3px;
  white-space: nowrap;
  color: #101114;
}

.quick-trigger__arrow {
  flex: none;
  font-size: 25px;
  line-height: 1;
  color: #858b95;
}

/* Звёзды «приглашения»: поочерёдная волна, как в макете. */
.animated-stars {
  display: flex;
  gap: 4px;
}

.animated-stars i {
  display: block;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  color: #dce0e7;
  animation: star-invite 3.8s ease-in-out infinite;
}

.animated-stars i:nth-child(2) { animation-delay: 0.17s; }
.animated-stars i:nth-child(3) { animation-delay: 0.34s; }
.animated-stars i:nth-child(4) { animation-delay: 0.51s; }
.animated-stars i:nth-child(5) { animation-delay: 0.68s; }

@keyframes star-invite {
  0%, 8%, 82%, 100% {
    color: #dce0e7;
    transform: scale(1);
  }
  24%, 60% {
    color: #d72b21;
    transform: scale(1.06);
  }
}

@media (max-width: 350px) {
  .review-entry__wide {
    min-height: 125px;
    gap: 8px;
    padding: 6px 12px 6px 8px;
  }

  .review-reward .reward-line {
    font-size: 9px;
  }

  .review-reward {
    margin-top: 7px;
  }

  .review-entry__art {
    width: 62px;
    height: 68px;
  }

  .review-entry__title {
    font-size: 14px;
    margin-bottom: 7px;
  }

  .review-entry__score {
    font-size: 26px;
    gap: 5px;
  }

  .review-entry__star {
    font-size: 26px;
  }

  .review-entry__sub {
    font-size: 10.5px;
  }

  .review-entry__arrow {
    font-size: 26px;
  }

  .quick-trigger {
    gap: 6px;
    padding-inline: 10px;
  }

  .quick-trigger__photo {
    width: 28px;
    height: 34px;
  }

  .quick-trigger__line {
    font-size: 10.5px;
  }

  .quick-trigger__arrow {
    font-size: 21px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animated-stars i {
    animation: none !important;
    color: #dce0e7;
  }
}
/* ===== /Плитка отзывов ===== */

/* ===== Вход в профиль =====
   Перенесено из navalivay-profile-component.html (BEGIN/END COMPONENT
   STYLES). Позиционирование обычное, position: static из исходника
   сохранён: строка не закрепляется и уходит при прокрутке.
   Обёртка задаёт боковые отступы и фон: строка стоит выше баннера,
   вне .main-content-wrapper, и без них прилипала бы к краям экрана. */
.profile-entry-section {
  position: relative;
  z-index: 10;
  max-width: 1280px;
  margin: 0 auto;
  padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 0;
  box-sizing: border-box;
}
.nvl-profile-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  position: static;
  width: 100%;
  min-width: 0;
  min-height: 70px;
  margin: 0;
  padding: 5px 0;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  color: #080a0b;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
}

.nvl-profile-entry__avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  overflow: hidden;
  box-sizing: border-box;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #4a4c53;
  font-size: 19px;
  font-weight: 500;
}

.nvl-profile-entry__avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.nvl-profile-entry__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nvl-profile-entry__name {
  display: block;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.5px;
  overflow-wrap: anywhere;
}

.nvl-profile-entry__subtitle {
  display: block;
  margin: 0;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.25;
  color: #8d919b;
}

.nvl-profile-entry__action {
  display: block;
  flex: none;
  padding: 10px;
  border-radius: 25px;
  background: #fff;
  color: #080a0b;
  font-size: 11px;
  font-weight: 600;
  line-height: normal;
  white-space: nowrap;
}

.nvl-profile-entry:focus-visible {
  outline: 2px solid #c52019;
  outline-offset: 4px;
  border-radius: 12px;
}

@media (max-width: 350px) {
  .nvl-profile-entry__subtitle {
    font-size: 9px;
  }

  .nvl-profile-entry__action {
    padding: 9px 8px;
    font-size: 10px;
  }
}
/* ===== /Вход в профиль ===== */

.banner-wrapper {
  overflow-x: hidden;
  overflow-y: visible;
  padding-top: 20px;
  background-color: #ffffff;
}

.banner-container {
  position: relative;
}

.wholesale-mode-card {
  background: linear-gradient(145deg, #191919 0%, #363636 100%);
  border-radius: var(--customer-radius-card-small, 20px);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #ffffff;
}

.wholesale-mode-kicker {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.58);
}

.wholesale-mode-title {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 22px;
}

.wholesale-mode-text {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: rgba(255, 255, 255, 0.78);
}

.active-order-section {
  padding: 12px 16px 0;
}

.active-order-banner {
  width: 100%;
  border: none;
  border-radius: var(--customer-radius-card, 24px);
  padding: 20px 20px 22px;
  background: var(--customer-red-gradient);
  color: #ffffff;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
}

.active-order-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.active-order-kicker {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 227, 226, 0.78);
}

.active-order-title {
  font-family: "Montserrat", sans-serif;
  font-size: 18px;
  line-height: 22px;
  font-weight: 700;
}

.active-order-text {
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: #ffd8d7;
  max-width: 270px;
}

.active-order-action {
  flex-shrink: 0;
  min-width: 92px;
  min-height: 48px;
  padding: 0 18px;
  border-radius: var(--customer-radius-action, 18px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--customer-surface, #ffffff);
  color: var(--customer-ink, #191919);
  font-family: "Montserrat", sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* ===== «Наш ассортимент» — витрина по демо navalivay-assortment =====
   Стили перенесены ДОСЛОВНО из демо (позиции дыма/LED отсчитываются
   от .assortment-stage с пропорцией 801/360 — совпадает с картинкой
   один в один, поэтому 31.3%/95% и 54.18%/59.17% точны). */
.assortment {
  display: block;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  appearance: none;
}

.assortment:focus-visible {
  outline: 3px solid #ed0000;
  outline-offset: 3px;
}

.assortment:active .assortment-picture {
  filter: brightness(0.98);
}

.assortment-picture {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 122px;
  background: linear-gradient(150deg, #fff, #fcfcfd);
  border-radius: var(--customer-radius-card-small, 20px);
  overflow: hidden;
  perspective: 700px;
}

/* Мягкие красные рефлексы по углам (демо .assortment-picture:before). */
.assortment-picture::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 15% 70%, rgba(248, 0, 0, 0.035), transparent 42%),
    radial-gradient(ellipse at 85% 50%, rgba(248, 0, 0, 0.03), transparent 42%);
  pointer-events: none;
}

/* Блик по витрине (демо product-sheen, тач-устройства). */
.assortment-picture::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: -30px auto -30px -80px;
  width: 65px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.05) 20%,
    rgba(255, 255, 255, 0.72) 50%,
    rgba(255, 255, 255, 0.05) 80%,
    transparent
  );
  mix-blend-mode: screen;
  transform: translateX(-60px) skewX(-18deg);
  opacity: 0;
  pointer-events: none;
  animation: product-sheen 6s cubic-bezier(0.3, 0.2, 0.5, 1) 0.5s infinite;
}

@keyframes product-sheen {
  0%,
  55% {
    opacity: 0;
    transform: translateX(-60px) skewX(-18deg);
  }
  62% {
    opacity: 0.7;
  }
  87% {
    opacity: 0.7;
  }
  95%,
  100% {
    opacity: 0;
    transform: translateX(560px) skewX(-18deg);
  }
}

/* Сцена с той же пропорцией, что и картинка (801/360): проценты
   дыма и LED отсюда совпадают с пикселями картинки. */
.assortment-stage {
  position: relative;
  display: block;
  flex: none;
  width: 249.2px;
  max-width: calc(100% - 12px);
  aspect-ratio: 801 / 360;
  transform: rotateY(var(--tilt-x, 0deg)) rotateX(var(--tilt-y, 0deg));
  transition: transform 0.4s ease;
  isolation: isolate;
}

.assortment-stage .assortment-art {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  position: relative;
  z-index: 1;
}

.assortment:active .assortment-stage {
  transform: scale(0.975);
  transition: transform 0.15s ease;
}

/* Дым из шланга кальяна — дословно из демо. */
.hose-smoke {
  position: absolute;
  left: 31.3%;
  top: 95%;
  width: 0;
  height: 0;
  z-index: 3;
  pointer-events: none;
}

.hose-smoke i {
  position: absolute;
  left: 0;
  top: -3px;
  width: 30px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgba(162, 166, 183, 0.87) 0%,
    rgba(184, 188, 202, 0.8) 25%,
    rgba(208, 211, 221, 0.47) 48%,
    transparent 76%
  );
  filter: blur(0.8px);
  opacity: 0;
  transform-origin: left center;
  animation: hose-drift 3s linear infinite;
}

.hose-smoke i:nth-child(2) { animation-delay: -0.6s; }
.hose-smoke i:nth-child(3) { animation-delay: -1.2s; }
.hose-smoke i:nth-child(4) { animation-delay: -1.8s; }
.hose-smoke i:nth-child(5) { animation-delay: -2.4s; }

@keyframes hose-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.3, 0.45) rotate(-4deg);
  }
  15% {
    opacity: 0.8;
  }
  45% {
    opacity: 0.65;
    transform: translate(18px, -5px) scale(1.1, 1) rotate(-12deg);
  }
  75% {
    opacity: 0.3;
    transform: translate(34px, -16px) scale(1.7, 1.7) rotate(-20deg);
  }
  100% {
    opacity: 0;
    transform: translate(48px, -29px) scale(2, 2.2) rotate(-28deg);
  }
}

/* Дышащий LED на под-системе — дословно из демо. */
.pod-led {
  position: absolute;
  z-index: 4;
  left: 54.18%;
  top: 59.17%;
  transform: translate(-50%, -50%);
  width: 1%;
  height: 10.5%;
  border-radius: 999px;
  background: #fff4ee;
  box-shadow:
    0 0 3px 1px #fff1e6,
    0 0 6px 2px #ff2222,
    0 0 12px 5px rgba(255, 0, 0, 0.67),
    0 0 21px 7px rgba(255, 0, 0, 0.3);
  opacity: 0.65;
  pointer-events: none;
  animation: pod-breathe 3s ease-in-out infinite;
}

@keyframes pod-breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

/* Заголовок витрины — как подпись плитки «Баланс кэшбэка» на этой
   же главной (.home-shortcuts__label в HomeShortcuts.vue):
   Montserrat / 600, но на 10% крупнее её 12px — 13px.
   Раньше был Bebas Neue 26px. */
.assortment__label {
  display: block;
  font-family: "Montserrat", sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.008em;
  margin-top: 9px;
  text-align: center;
  color: #000000;
}

/* Десктоп с мышью: наклон вместо блика (как в демо). */
@media (hover: hover) and (pointer: fine) {
  .assortment-picture::after {
    display: none;
    animation: none;
  }
}

@media (max-width: 350px) {
  .assortment-picture {
    height: 106px;
    border-radius: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assortment-picture::after {
    animation: none;
  }

  .hose-smoke {
    display: none;
  }

  .pod-led {
    animation: none;
    opacity: 0.6;
  }

  .assortment-stage {
    transition: none;
    transform: none !important;
  }
}
/* Main Content Wrapper: композиция главной занимает всю высоту экрана
   (верхняя панель убрана, вычитать её высоту больше не нужно); если
   контента больше экрана, flex переходит в обычный поток без обрезки. */
.main-content-wrapper {
  max-width: 1280px;
  min-height: 100dvh;
  margin: 0 auto;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.assortment-section {
  position: relative;
  min-height: 0;
  margin-top: 0;
  width: 100%;
  box-sizing: border-box;
}
</style>
