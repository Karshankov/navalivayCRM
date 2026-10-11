<template>
  <div class="profile-page">
    <div class="profile-container">
      <section class="user-card">
        <div class="user-avatar-wrap">
          <img
            v-if="userStore.photoUrl && !avatarError"
            :src="userStore.photoUrl"
            :alt="userStore.displayName"
            class="user-avatar"
            @error="avatarError = true"
          />
          <div v-else class="user-avatar user-avatar--placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="#AAB2BD" stroke-width="1.8" />
              <path
                d="M4 21C4 17.134 7.58172 14 12 14C16.4183 14 20 17.134 20 21"
                stroke="#AAB2BD"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </div>
        </div>

        <div class="user-info">
          <h1 class="user-name">
            <template v-if="userStore.isLoading">Загрузка...</template>
            <template v-else>{{ userStore.displayName }}</template>
          </h1>
          <p v-if="userStore.hasUsername" class="user-username">
            @{{ userStore.profile?.telegramUsername }}
          </p>
          <p v-else class="user-username user-username--missing">
            Username не установлен
          </p>
        </div>
      </section>

      <section
        v-if="userStore.cardPaymentStatus?.enabled"
        class="card-limit-card"
        aria-labelledby="card-limit-title"
      >
        <div class="card-limit-heading">
          <div>
            <p class="card-limit-eyebrow">СПОСОБ ОПЛАТЫ</p>
            <h2 id="card-limit-title">Лимит по карте</h2>
          </div>
          <span class="card-limit-status" :class="{ 'card-limit-status--blocked': isCardPaused }">
            {{ isCardPaused ? 'На паузе' : 'Разрешена' }}
          </span>
        </div>
        <div class="card-limit-total">
          {{ formatCardAmount(userStore.cardPaymentStatus.monthly_remaining_minor) }}
          <span>BYN осталось в этом месяце</span>
        </div>
        <div class="card-limit-breakdown">
          <div>
            <span>Потрачено по карте</span>
            <strong>{{ formatCardAmount(userStore.cardPaymentStatus.monthly_used_minor) }} BYN</strong>
          </div>
          <div>
            <span>Лимит на месяц</span>
            <strong>{{ formatCardAmount(userStore.cardPaymentStatus.monthly_limit_minor) }} BYN</strong>
          </div>
        </div>
        <div class="card-limit-progress" aria-label="Использование месячного лимита">
          <span :style="{ width: cardMonthlyProgress(userStore.cardPaymentStatus) }" />
        </div>
        <p class="card-limit-personal">
          Лимит одного заказа:
          <strong>{{ formatCardAmount(userStore.cardPaymentStatus.max_order_minor) }} BYN</strong>
        </p>
        <div v-if="userStore.cardPaymentStatus.cooldown_until" class="card-limit-pause" role="status">
          <div class="card-limit-pause__row">
            <strong>Оплата по карте станет доступна {{ formatCardDate(userStore.cardPaymentStatus.cooldown_until) }}</strong>
          </div>
          <span class="card-limit-pause__days">({{ cardCooldownDaysLeft(userStore.cardPaymentStatus.cooldown_until) }} до снятия паузы)</span>
        </div>
        <p v-else-if="userStore.cardPaymentStatus.monthly_remaining_minor <= 0" class="card-limit-cooldown">
          Месячный лимит исчерпан. Он обновится в следующем месяце.
        </p>
        <button type="button" class="card-limit-increase-button" @click="openCardLimitRequest">
          Увеличить лимиты
        </button>
      </section>

      <div v-if="showCardLimitRequest" class="profile-card-modal" role="dialog" aria-modal="true" aria-labelledby="card-request-title">
        <button class="profile-card-modal__backdrop" aria-label="Закрыть" @click="closeCardLimitRequest" />
        <div class="profile-card-modal__card">
          <div class="profile-card-modal__header">
            <h2 id="card-request-title">Увеличить лимиты</h2>
            <button type="button" class="profile-card-modal__close" @click="closeCardLimitRequest">×</button>
          </div>
          <p class="profile-card-modal__text">Выберите тариф — заявка поступит продавцу на обработку.</p>
          <label v-for="tariff in cardRequestTariffs" :key="tariff.id" class="profile-card-tariff">
            <input v-model="selectedCardTariff" type="radio" :value="tariff.id">
            <span><strong>{{ tariff.title }}</strong><small>{{ formatCardAmount(tariff.limit_minor) }} BYN · {{ tariff.transition_cost_text }}</small></span>
          </label>
          <p v-if="cardRequestSuccess" class="profile-card-request-success">Ваша заявка принята, с вами свяжутся.</p>
          <p v-if="cardRequestError" class="profile-card-request-error">{{ cardRequestError }}</p>
          <button type="button" class="card-limit-increase-button" :disabled="cardRequestSending || !selectedCardTariff || Boolean(userStore.cardPaymentStatus?.request_cooldown_until)" @click="submitCardLimitRequest">
            {{ cardRequestSending ? 'Отправляем…' : cardRequestSuccess ? 'Готово' : 'Отправить заявку' }}
          </button>
        </div>
      </div>

      <section class="loyalty-section">
        <article
          v-if="wholesaleStore.isWholesale"
          class="wholesale-profile-card"
        >
          <div class="wholesale-profile-card__icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect x="6" y="11" width="24" height="18" rx="3" stroke="#1F2933" stroke-width="1.8" />
              <path d="M11 11V8C11 6.34315 12.3431 5 14 5H22C23.6569 5 25 6.34315 25 8V11"
                stroke="#1F2933" stroke-width="1.8" stroke-linecap="round" />
              <path d="M6 18H30" stroke="#1F2933" stroke-width="1.8" />
            </svg>
          </div>
          <h2 class="wholesale-profile-card__title">Для оптовых клиентов</h2>
          <p class="wholesale-profile-card__text">
            Тут пока ничего нет, но мы добавим сюда полезный функционал.
          </p>
          <p class="wholesale-profile-card__hint">
            Настройка ленты рулетки доступна ниже.
          </p>
        </article>

        <article
          v-else
          class="loyalty-card"
          :class="{ 'loyalty-card--empty': !selectedLoyaltyCategory }"
        >
          <div class="loyalty-card-header">
            <h2 class="loyalty-card-title-main">Бонусная система</h2>
            <p v-if="loyaltyStore.loadingSnapshot" class="loyalty-loading">Обновляем...</p>
          </div>

          <template v-if="selectedLoyaltyCategory">
            <div class="loyalty-tabs" role="tablist" aria-label="Категории бонусов">
              <button
                v-for="category in orderedLoyaltyCategories"
                :key="category.id"
                type="button"
                class="loyalty-tab"
                :class="{ 'loyalty-tab--active': category.key === activeLoyaltyKey }"
                @click="activeLoyaltyKey = category.key"
              >
                {{ loyaltyCategoryLabel(category) }}
              </button>
            </div>

            <div class="loyalty-progress-row">
              <div class="loyalty-progress-track">
                <div
                  class="loyalty-progress-fill"
                  :style="{ width: `${progressPercent(selectedLoyaltyCategory)}%` }"
                ></div>
              </div>
              <span class="loyalty-progress-value">
                {{ progressLabel(selectedLoyaltyCategory) }}
              </span>
            </div>

            <div class="loyalty-copy-row">
              <p class="loyalty-copy">
                <template
                  v-for="(line, index) in selectedLoyaltyDescriptionLines"
                  :key="`${selectedLoyaltyCategory.key}-${index}`"
                >
                  <span class="loyalty-copy-line">
                    {{ line }}
                    <span
                      v-if="index === selectedLoyaltyDescriptionLines.length - 1"
                      class="loyalty-discount"
                    >
                      {{ selectedLoyaltyCategory.discount_amount }} BYN
                    </span>
                  </span>
                  <br v-if="index < selectedLoyaltyDescriptionLines.length - 1" />
                </template>
              </p>
            </div>

            <button
              type="button"
              class="loyalty-rules-link"
              @click="openRulesModal"
            >
              <span>Как работают скидки за покупки</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M3 1.5L7.5 6L3 10.5"
                  stroke="white"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </template>

          <template v-else>
            <p class="loyalty-empty-copy">
              Как только у вас появятся покупки по бонусным категориям, здесь появится прогресс.
            </p>
          </template>
        </article>

        <router-link to="/profile/orders" class="orders-link-card">
          <div class="orders-link-card__icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 4H17L19 8H5L7 4Z"
                stroke="#1F2933"
                stroke-width="1.8"
                stroke-linejoin="round"
              />
              <path
                d="M5 8H19V18C19 19.1046 18.1046 20 17 20H7C5.89543 20 5 19.1046 5 18V8Z"
                stroke="#1F2933"
                stroke-width="1.8"
              />
              <path d="M9 12H15" stroke="#1F2933" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </div>
          <div class="orders-link-card__text">
            <h3 class="orders-link-card__title">Мои заказы</h3>
            <p class="orders-link-card__copy">История покупок и отзывы</p>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M3 1.5L7.5 6L3 10.5"
              stroke="#AAB2BD"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </router-link>

        <article class="wheel-feed-card">
          <div class="wheel-feed-card__text">
            <h3 class="wheel-feed-card__title">Лента рулетки</h3>
            <p class="wheel-feed-card__copy">
              Показывать моё имя и фото в ленте, если выиграю приз.
            </p>
          </div>
          <button
            type="button"
            class="wheel-feed-toggle"
            role="switch"
            :aria-checked="wheelStore.feedConsent"
            :disabled="wheelStore.isUpdatingConsent"
            :class="{ 'wheel-feed-toggle--on': wheelStore.feedConsent }"
            @click="onToggleFeedConsent"
          >
            <span class="wheel-feed-toggle__knob"></span>
          </button>
        </article>

        <article class="wheel-feed-card">
          <div class="wheel-feed-card__text">
            <h3 class="wheel-feed-card__title">Напоминания об отзывах</h3>
            <p class="wheel-feed-card__copy">
              Показывать подсказку оставить отзыв после покупки.
            </p>
          </div>
          <button
            type="button"
            class="wheel-feed-toggle"
            role="switch"
            :aria-checked="!reviewPreferences.reviews_opt_out"
            :disabled="isUpdatingReviewPrefs"
            :class="{ 'wheel-feed-toggle--on': !reviewPreferences.reviews_opt_out }"
            @click="onToggleReviewPrompts"
          >
            <span class="wheel-feed-toggle__knob"></span>
          </button>
        </article>

        <article class="wheel-feed-card">
          <div class="wheel-feed-card__text">
            <h3 class="wheel-feed-card__title">Анонимные отзывы</h3>
            <p class="wheel-feed-card__copy">
              По умолчанию публиковать отзывы без имени.
            </p>
          </div>
          <button
            type="button"
            class="wheel-feed-toggle"
            role="switch"
            :aria-checked="reviewPreferences.reviews_prefer_anonymous"
            :disabled="isUpdatingReviewPrefs"
            :class="{ 'wheel-feed-toggle--on': reviewPreferences.reviews_prefer_anonymous }"
            @click="onToggleAnonymousReviews"
          >
            <span class="wheel-feed-toggle__knob"></span>
          </button>
        </article>

        <div v-if="loyaltyStore.snapshotError" class="loyalty-error">
          {{ loyaltyStore.snapshotError }}
        </div>
      </section>

    </div>

    <Transition name="rules-modal">
      <div
        v-if="showRulesModal"
        class="rules-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-modal-title"
        @click.self="closeRulesModal"
      >
        <section class="rules-modal-card">
          <div class="rules-modal-header">
            <h2 id="rules-modal-title" class="rules-modal-title">
              {{ LOYALTY_RULES_MODAL_TITLE }}
            </h2>
            <button
              type="button"
              class="rules-modal-close"
              aria-label="Закрыть окно"
              @click="closeRulesModal"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="#191919"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>

          <div class="rules-modal-copy">
            <p v-for="paragraph in LOYALTY_RULES_MODAL_PARAGRAPHS" :key="paragraph">
              {{ paragraph }}
            </p>
          </div>

          <button type="button" class="rules-modal-cta" @click="goShopping">
            За покупками
          </button>
        </section>
      </div>
    </Transition>

    <LoyaltyBonusPopup
      :open="showLoyaltyPopup"
      :categories="loyaltyStore.availableCategories"
      @close="showLoyaltyPopup = false"
      @open-profile="showLoyaltyPopup = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import router from "@/router";
import { useUserStore } from "@/stores/user";
import { useLoyaltyStore, type LoyaltySnapshotCategory } from "@/stores/loyalty";
import { useWholesaleStore } from "@/stores/wholesale";
import { useWheelStore } from "@/stores/wheel";
import { getTelegramIdentity } from "@/utils/customerOrders";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";
import LoyaltyBonusPopup from "@/components/LoyaltyBonusPopup.vue";
import {
  LOYALTY_RULES_MODAL_PARAGRAPHS,
  LOYALTY_RULES_MODAL_TITLE,
} from "@/constants/loyalty";
import { useCustomerOrders } from "@/composables/useCustomerOrders";

const userStore = useUserStore();
const loyaltyStore = useLoyaltyStore();
const wholesaleStore = useWholesaleStore();
const wheelStore = useWheelStore();
const avatarError = ref(false);

watch(
  () => userStore.photoUrl,
  () => {
    avatarError.value = false;
  },
);
const activeLoyaltyKey = ref<string | null>(null);
const showRulesModal = ref(false);
const showLoyaltyPopup = ref(false);
const showCardLimitRequest = ref(false);
const cardRequestTariffs = ref<Array<{ id: string; title: string; limit_minor: number; transition_cost_text?: string }>>([]);
const selectedCardTariff = ref("");
const cardRequestSending = ref(false);
const cardRequestSuccess = ref(false);
const cardRequestError = ref("");
const isUpdatingReviewPrefs = ref(false);
const {
  reviewPreferences,
  fetchReviewPrompt,
  updateReviewPreferences,
} = useCustomerOrders();

const LOYALTY_CATEGORY_ORDER = ["liquids", "disposables", "devices"];
const LOYALTY_CATEGORY_LABELS: Record<string, string> = {
  liquids: "Жидкости",
  disposables: "Одноразки",
  devices: "Устройства",
};

const orderedLoyaltyCategories = computed(() => {
  return [...loyaltyStore.snapshot].sort((left, right) => {
    const leftIndex = LOYALTY_CATEGORY_ORDER.indexOf(left.key);
    const rightIndex = LOYALTY_CATEGORY_ORDER.indexOf(right.key);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }

    return left.title.localeCompare(right.title, "ru");
  });
});

const selectedLoyaltyCategory = computed(() => {
  if (!orderedLoyaltyCategories.value.length) {
    return null;
  }

  return (
    orderedLoyaltyCategories.value.find(
      (category) => category.key === activeLoyaltyKey.value,
    ) || orderedLoyaltyCategories.value[0]
  );
});

const selectedLoyaltyDescriptionLines = computed(() => {
  if (!selectedLoyaltyCategory.value) {
    return [];
  }

  return loyaltyDescriptionLines(selectedLoyaltyCategory.value);
});

watch(
  orderedLoyaltyCategories,
  (categories) => {
    if (!categories.length) {
      activeLoyaltyKey.value = null;
      return;
    }

    if (!categories.some((category) => category.key === activeLoyaltyKey.value)) {
      activeLoyaltyKey.value = categories[0].key;
    }
  },
  { immediate: true },
);

watch(showRulesModal, (isOpen) => {
  if (typeof document === "undefined") {
    return;
  }

  const overflowValue = isOpen ? "hidden" : "";
  document.documentElement.style.overflow = overflowValue;
  document.body.style.overflow = overflowValue;
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
});

onMounted(async () => {
  const identity = getTelegramIdentity();

  // Snapshot нужен чтобы карточка «Скидки за покупки» на этой же странице
  // отрисовала актуальный прогресс. Авто-показ LoyaltyBonusPopup при заходе
  // в профиль убран по просьбе заказчика — попап «У вас уже есть доступные
  // бонусы» дублировал ту же информацию, которая и так видна на странице
  // профиля сразу под карточкой бонусов.
  await Promise.allSettled([
    userStore.fetchProfile(),
    userStore.fetchCardPaymentStatus(),
    loyaltyStore.fetchSnapshot(identity),
    fetchReviewPrompt().catch(() => undefined),
    // Q6: load the consent flag so the toggle reflects the server
    // state. Round 4 fix: previously this was skipped for wholesale
    // customers, but the toggle is rendered for everyone (wholesale
    // can win wheel prizes too via is_wholesale flag) — without the
    // fetch the toggle shows "off" even if the server has consent=1,
    // and a tap silently revokes it. Always load. Errors are
    // swallowed because the toggle keeps the previous value (default
    // "off") if the wheel API is briefly unavailable.
    wheelStore.fetchState().catch(() => undefined),
  ]);
});

const isCardPaused = computed(() => {
  const until = userStore.cardPaymentStatus?.cooldown_until
  return Boolean(until) && new Date(String(until)).getTime() > Date.now()
})

function formatCardAmount(minor: number) {
  return (Number(minor || 0) / 100).toLocaleString('ru-BY', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function cardMonthlyProgress(status: { monthly_used_minor?: number; monthly_limit_minor?: number } | null | undefined) {
  const used = Number(status?.monthly_used_minor || 0);
  const limit = Math.max(1, Number(status?.monthly_limit_minor || 1));
  return `${Math.min(100, (used / limit) * 100)}%`;
}

function formatCardDate(value: string) {
  return new Intl.DateTimeFormat('ru-BY', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Minsk',
  }).format(new Date(value))
}

function cardCooldownDaysLeft(value: string) {
  const days = Math.ceil(Math.max(0, new Date(value).getTime() - Date.now()) / 86400000);
  const mod10 = days % 10;
  const mod100 = days % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "дня";
  return `${days} ${word}`;
}

async function openCardLimitRequest() {
  cardRequestError.value = "";
  cardRequestSuccess.value = false;
  try {
    const response = await fetch("/api/card-payment/tariffs", {
      headers: withTelegramAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error("Не удалось загрузить тарифы");
    cardRequestTariffs.value = result.tariffs || [];
    selectedCardTariff.value = cardRequestTariffs.value[0]?.id || "";
    showCardLimitRequest.value = true;
  } catch (error: any) {
    cardRequestError.value = error?.message || "Не удалось загрузить тарифы";
  }
}

function closeCardLimitRequest() {
  if (!cardRequestSending.value) showCardLimitRequest.value = false;
}

async function submitCardLimitRequest() {
  if (!selectedCardTariff.value || cardRequestSending.value) return;
  cardRequestSending.value = true;
  cardRequestError.value = "";
  try {
    const response = await fetch("/api/card-payment/requests", {
      method: "POST",
      headers: withTelegramAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tariff_id: selectedCardTariff.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error === "card_request_cooldown"
      ? "Повторно отправить заявку можно через час."
      : result?.message || "Не удалось отправить заявку");
    cardRequestSuccess.value = true;
    if (userStore.cardPaymentStatus) {
      userStore.cardPaymentStatus.request_cooldown_until = new Date(Date.now() + 3600000).toISOString();
    }
  } catch (error: any) {
    cardRequestError.value = error?.message || "Не удалось отправить заявку";
  } finally {
    cardRequestSending.value = false;
  }
}

async function onToggleReviewPrompts() {
  const previous = reviewPreferences.value.reviews_opt_out;
  const next = !previous;
  isUpdatingReviewPrefs.value = true;
  try {
    await updateReviewPreferences({ reviews_opt_out: next });
  } catch (error) {
    reviewPreferences.value.reviews_opt_out = previous;
    console.warn("[profile] review opt-out update failed", error);
  } finally {
    isUpdatingReviewPrefs.value = false;
  }
}

async function onToggleAnonymousReviews() {
  const previous = reviewPreferences.value.reviews_prefer_anonymous;
  const next = !previous;
  isUpdatingReviewPrefs.value = true;
  try {
    await updateReviewPreferences({ reviews_prefer_anonymous: next });
  } catch (error) {
    reviewPreferences.value.reviews_prefer_anonymous = previous;
    console.warn("[profile] review anonymous preference update failed", error);
  } finally {
    isUpdatingReviewPrefs.value = false;
  }
}

async function onToggleFeedConsent() {
  // Round 4 best-practice: optimistic UI with rollback. Flip the
  // local view first for snappy UX; if the request fails revert and
  // surface the error in console — there is no toast surface on this
  // page; the next refresh will reconcile.
  const previous = wheelStore.feedConsent;
  const next = !previous;
  wheelStore.feedConsent = next;
  try {
    await wheelStore.setFeedConsent(next);
  } catch (error) {
    wheelStore.feedConsent = previous;
    console.warn("[profile] feed-consent update failed", error);
  }
}

function loyaltyCategoryLabel(category: LoyaltySnapshotCategory) {
  return LOYALTY_CATEGORY_LABELS[category.key] || category.title;
}

function progressCurrentValue(category: LoyaltySnapshotCategory) {
  const threshold = Number(category.threshold || 0);
  if (!threshold) return 0;

  const remaining = Math.max(0, Number(category.remaining_to_next || 0));
  if (remaining === 0) {
    return threshold;
  }

  return Math.max(0, Math.min(threshold, threshold - remaining));
}

function progressLabel(category: LoyaltySnapshotCategory) {
  return `${progressCurrentValue(category)} / ${category.threshold}`;
}

function progressPercent(category: LoyaltySnapshotCategory) {
  const threshold = Number(category.threshold || 0);
  if (!threshold) return 0;
  return Math.round((progressCurrentValue(category) / threshold) * 100);
}

function loyaltyDescriptionLines(category: LoyaltySnapshotCategory) {
  const threshold = Number(category.threshold || 0);

  if (category.key === "liquids") {
    return [
      `За каждую ${threshold}-ую купленную`,
      "жидкость/снюс вы получите",
      "скидку на товар",
    ];
  }

  if (category.key === "disposables") {
    return [`За каждую ${threshold}-ую купленную одноразку`, "вы получите скидку на товар"];
  }

  if (category.key === "devices") {
    return [`За каждое ${threshold}-ое купленное устройство`, "вы получите скидку на товар"];
  }

  return [
    `За каждые ${threshold} покупок в категории`,
    `${loyaltyCategoryLabel(category).toLowerCase()} вы получите`,
    "скидку на товар",
  ];
}

function openRulesModal() {
  showRulesModal.value = true;
}

function closeRulesModal() {
  showRulesModal.value = false;
}

async function goShopping() {
  showRulesModal.value = false;

  if (router.currentRoute.value.name !== "home") {
    await router.push({ name: "home" });
  }
}
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 24px;
}

.profile-container {
  width: min(393px, 100%);
  margin: 0 auto;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}

.user-card {
  background: #ffffff;
  border-radius: 24px;
}

.card-limit-card {
  border: 1px solid #d9e7fb;
  border-radius: 20px;
  padding: 18px;
  background: linear-gradient(135deg, #ffffff 0%, #f0f6ff 100%);
  box-shadow: 0 4px 18px rgba(47, 104, 179, 0.08);
}

.card-limit-progress {
  height: 8px;
  margin: 14px 0 12px;
  overflow: hidden;
  border-radius: 999px;
  background: #dbeafe;
}

.card-limit-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f80ed, #60a5fa);
  transition: width 0.25s ease;
}

.card-limit-increase-button {
  width: 100%;
  min-height: 44px;
  margin-top: 14px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(90deg, #f50302, #a90f0e);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.card-limit-increase-button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.profile-card-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 20px;
}

.profile-card-modal__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(25, 25, 25, .55);
}

.profile-card-modal__card {
  position: relative;
  width: min(393px, 100%);
  padding: 20px;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(25, 25, 25, .2);
}

.profile-card-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.profile-card-modal__header h2 {
  margin: 0;
  font-size: 20px;
}

.profile-card-modal__close {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: #f1f3f5;
  font-size: 22px;
  cursor: pointer;
}

.profile-card-modal__text {
  margin: 10px 0 16px;
  color: #5c6470;
  font-size: 14px;
}

.profile-card-tariff {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 10px;
  padding: 13px;
  border: 1px solid #e2e8f0;
  border-radius: 13px;
  cursor: pointer;
}

.profile-card-tariff span {
  display: grid;
  gap: 3px;
}

.profile-card-tariff small {
  color: #7b8794;
}

.profile-card-request-success {
  color: #16824c;
  font-size: 14px;
}

.profile-card-request-error {
  color: #b42318;
  font-size: 14px;
}

.card-limit-card--disabled {
  border-color: #e2e8f0;
  background: #ffffff;
  box-shadow: none;
}

.card-limit-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-limit-eyebrow {
  margin: 0 0 4px;
  color: #7b8794;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.card-limit-heading h2 {
  margin: 0;
  color: #1f2933;
  font-size: 18px;
  font-weight: 750;
}

.card-limit-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 6px 9px;
  background: #e5f6ee;
  color: #16824c;
  font-size: 11px;
  font-weight: 700;
}

.card-limit-status--blocked {
  background: #fff0e5;
  color: #ad5a15;
}

.card-limit-total {
  margin-top: 18px;
  color: #1f2933;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
}

.card-limit-total span {
  color: #687582;
  font-size: 13px;
  font-weight: 600;
}

.card-limit-personal {
  margin: 8px 0 0;
  color: #687582;
  font-size: 12px;
}

.card-limit-personal strong {
  color: #263746;
}

.card-limit-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}

.card-limit-breakdown > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-radius: 13px;
  padding: 11px 12px;
  background: rgba(255, 255, 255, 0.86);
}

.card-limit-breakdown span {
  color: #687582;
  font-size: 11px;
}

.card-limit-breakdown strong {
  color: #263746;
  font-size: 14px;
}

.card-limit-breakdown > div:last-child strong {
  color: #16824c;
}

.card-limit-pause {
  margin-top: 12px;
  border: 1px solid #f6c991;
  border-radius: 12px;
  padding: 10px 12px;
  background: #fff4e3;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.card-limit-pause__row strong {
  color: #9b4a10;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.35;
}

.card-limit-pause__days {
  color: #b06a24;
  font-size: 11.5px;
  font-weight: 600;
}

.card-limit-cooldown {
  margin: 12px 0 0;
  color: #9b551b;
  font-size: 12px;
  line-height: 1.45;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  box-shadow: 0 10px 24px rgba(25, 25, 25, 0.06);
}

.user-avatar-wrap {
  flex-shrink: 0;
}

.user-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  border: 1px solid #e6e9ed;
}

.user-info {
  min-width: 0;
}

.user-name {
  margin: 0 0 4px;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.user-username {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 17px;
  color: #aab2bd;
}

.user-username--missing {
  color: #dc2626;
}

.loyalty-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wholesale-profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 28px 24px;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
}

.wholesale-profile-card__icon {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wholesale-profile-card__title {
  font-family: 'Montserrat', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #1f2933;
  margin: 0;
}

.wholesale-profile-card__text {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 14px;
  color: #5c6470;
  margin: 0;
  max-width: 280px;
  line-height: 1.4;
}

.wholesale-profile-card__hint {
  font-family: 'SF Pro Display', system-ui, sans-serif;
  font-size: 13px;
  color: #8a93a0;
  margin: 0;
  max-width: 280px;
  line-height: 1.4;
}

.loyalty-card {
  position: relative;
  overflow: hidden;
  height: 231px;
  display: flex;
  flex-direction: column;
  padding: 24px 24px 45px;
  border-radius: 24px;
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
  box-shadow: 0 8px 16px rgba(97, 1, 0, 0.16);
}

.loyalty-card--empty {
  justify-content: space-between;
}

.loyalty-card-header,
.loyalty-tabs,
.loyalty-progress-row,
.loyalty-copy-row,
.loyalty-rules-link,
.loyalty-empty-copy {
  position: relative;
  z-index: 1;
}

.loyalty-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.loyalty-card-title-main {
  margin: 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #ffffff;
}

.loyalty-loading {
  margin: 2px 0 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 12px;
  line-height: 14px;
  color: rgba(255, 255, 255, 0.88);
  white-space: nowrap;
}

.loyalty-tabs {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 9px;
  flex-wrap: nowrap;
}

.loyalty-tab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 33px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 8px 10px;
  border-radius: 123px;
  background: transparent;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 14px;
  line-height: 17px;
  color: #ffffff;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.loyalty-tab--active {
  background: #ffffff;
  color: #191919;
}

.loyalty-progress-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 15px;
}

.loyalty-progress-track {
  position: relative;
  flex: 1;
  height: 12px;
  border-radius: 123px;
  background: rgba(230, 233, 237, 0.24);
  overflow: hidden;
}

.loyalty-progress-fill {
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255, 227, 226, 0.72) 0%, #ffffff 100%);
  transition: width 0.24s ease;
}

.loyalty-progress-value {
  min-width: 29px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  text-align: right;
  color: #ffffff;
}

.loyalty-copy-row {
  margin-top: 12px;
}

.loyalty-copy {
  max-width: 282px;
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 14px;
  line-height: 17px;
  color: #e9bbbb;
}

.loyalty-discount {
  display: inline;
  margin-left: 6px;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 700;
  font-size: 14px;
  line-height: 17px;
  color: #ffffff;
  white-space: nowrap;
}

.loyalty-rules-link {
  position: absolute;
  left: 24px;
  bottom: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 400;
  font-size: 12px;
  line-height: 14px;
  color: #ffffff;
  cursor: pointer;
}

.loyalty-rules-link svg {
  flex-shrink: 0;
}

.loyalty-empty-copy {
  max-width: 250px;
  margin: auto 0 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 14px;
  line-height: 19px;
  color: rgba(255, 255, 255, 0.86);
}

.loyalty-error {
  padding: 14px 16px;
  border-radius: 18px;
  background: #fff1f2;
  color: #be123c;
  font-size: 14px;
  line-height: 18px;
}

.orders-link-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  text-decoration: none;
  color: inherit;
}

.orders-link-card__icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: #f5f7fa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.orders-link-card__text {
  flex: 1 1 auto;
  min-width: 0;
}

.orders-link-card__title {
  margin: 0 0 4px;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 19px;
  color: #1f2933;
}

.orders-link-card__copy {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 17px;
  color: #5c6470;
}

.wheel-feed-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.wheel-feed-card__text {
  flex: 1 1 auto;
  min-width: 0;
}

.wheel-feed-card__title {
  margin: 0 0 4px;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 19px;
  color: #1f2933;
}

.wheel-feed-card__copy {
  margin: 0;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-size: 13px;
  line-height: 17px;
  color: #5c6470;
}

.wheel-feed-toggle {
  position: relative;
  width: 48px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  background: #d8dde4;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.wheel-feed-toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wheel-feed-toggle--on {
  background: linear-gradient(106.76deg, #f50302 -2.64%, #a90f0e 85.78%);
}

.wheel-feed-toggle__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
  transition: transform 0.2s ease;
}

.wheel-feed-toggle--on .wheel-feed-toggle__knob {
  transform: translateX(20px);
}

.rules-modal-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    calc(24px + env(safe-area-inset-top, 0px))
    16px
    calc(var(--app-bottom-tab-bar-height, 130px) + 24px);
  background: rgba(101, 109, 119, 0.72);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
}

.rules-modal-enter-active,
.rules-modal-leave-active {
  transition: opacity 0.24s ease;
}

.rules-modal-enter-active .rules-modal-card,
.rules-modal-leave-active .rules-modal-card {
  transition:
    opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.rules-modal-enter-from,
.rules-modal-leave-to {
  opacity: 0;
}

.rules-modal-enter-from .rules-modal-card,
.rules-modal-leave-to .rules-modal-card {
  opacity: 0;
  transform: translateY(18px) scale(0.985);
}

.rules-modal-card {
  width: min(361px, 100%);
  border-radius: 20px;
  background: #ffffff;
  box-sizing: border-box;
  padding: 16px;
  box-shadow: 0 24px 48px rgba(25, 25, 25, 0.12);
  transform-origin: center center;
  will-change: transform, opacity;
}

.rules-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.rules-modal-title {
  margin: 8px 0 0;
  font-family: "Montserrat", sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 24px;
  color: #191919;
}

.rules-modal-close {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: none;
  border-radius: 512px;
  background: #f5f7fa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.rules-modal-copy {
  margin-top: 12px;
  color: #191919;
  font-family: -apple-system, "SF Pro Display", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 19px;
}

.rules-modal-copy p {
  margin: 0;
}

.rules-modal-copy p + p {
  margin-top: 24px;
}

.rules-modal-cta {
  margin-top: 28px;
  width: 100%;
  min-height: 64px;
  border: none;
  border-radius: 528px;
  background: linear-gradient(90deg, #f50302 0%, #a90f0e 100%);
  color: #ffffff;
  font-family: "Montserrat", sans-serif;
  font-weight: 500;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}

@media (max-width: 360px) {
  .profile-container {
    padding: 20px 12px;
  }

  .loyalty-card {
    padding: 20px 20px 41px;
    height: auto;
    min-height: 231px;
  }

  .loyalty-copy-row {
  }

  .loyalty-copy {
    max-width: none;
  }

  .loyalty-tabs {
    gap: 8px;
  }

  .loyalty-tab {
    padding: 8px 6px;
    font-size: 13px;
    line-height: 16px;
  }

  .loyalty-rules-link {
    left: 20px;
    bottom: 20px;
    gap: 6px;
  }

  .rules-modal-overlay {
    padding:
      calc(20px + env(safe-area-inset-top, 0px))
      12px
      calc(var(--app-bottom-tab-bar-height, 130px) + 20px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rules-modal-enter-active,
  .rules-modal-leave-active,
  .rules-modal-enter-active .rules-modal-card,
  .rules-modal-leave-active .rules-modal-card {
    transition-duration: 0.01ms;
  }
}
</style>
