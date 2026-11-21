<template>
  <div class="crm-reviews-page">
    <div class="crm-reviews-content">
      <header class="crm-reviews-head">
        <div>
          <h1 class="crm-reviews-title">Отзывы</h1>
          <p class="crm-reviews-subtitle">
            Модерация: отзывы, которые покупатели оставили после покупки.
          </p>
        </div>

        <button
          v-if="pendingCount"
          type="button"
          class="crm-reviews-counter"
          aria-label="`Отзывов ждёт модерации: ${pendingCount}`"
        >
          {{ pendingCount }}
          <span>в очереди</span>
        </button>
      </header>

      <section
        id="reviews-panel-moderation"
        aria-label="Отзывы на модерации"
        class="crm-reviews-panel"
      >
        <div class="crm-reviews-panel-head">
          <h2>На модерации</h2>
          <CrmButton
            variant="secondary"
            size="sm"
            refresh-icon
            :loading="loading"
            loading-label="Обновляем..."
            @click="loadReviews"
          >
            Обновить
          </CrmButton>
        </div>

        <p class="mt-2 text-xs text-slate-400">В очереди до 200 штук.</p>

        <div v-if="loading && pendingReviews.length === 0" class="crm-reviews-loading">
          <span class="crm-review-spinner" aria-hidden="true" />
          Загружаем очередь…
        </div>
        <div v-else-if="pendingReviews.length === 0" class="crm-reviews-empty">
          <span class="crm-reviews-empty-symbol" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6.5 9.5 17 4 11.5" />
            </svg>
          </span>
          <b>Очередь пуста</b>
          <span>Отзывы появятся здесь после выдачи заказа клиенту.</span>
        </div>

        <div
          v-else
          class="crm-reviews-queue"
          :class="{ 'crm-reviews-queue--busy': loading }"
        >
          <article
            v-for="review in pendingReviews"
            :key="review.id"
            class="crm-review-card"
          >
            <!-- Верх карточки: оценка крупно, товар и автор рядом. -->
            <header class="crm-review-head">
              <span class="crm-review-score" :class="scoreClass(review.rating)">
                <b>{{ review.rating }}</b>
                <span class="crm-review-score-max">/5</span>
              </span>

              <div class="crm-review-who">
                <RouterLink
                  v-if="review.order_id"
                  :to="`/admin/crm/orders/${review.order_id}`"
                  class="crm-review-order"
                >
                  Заказ №{{ review.order_number }}
                </RouterLink>
                <strong v-else-if="review.order_number" class="crm-review-order crm-review-order--plain">
                  Заказ №{{ review.order_number }}
                </strong>

                <p class="crm-review-product">
                  {{ review.group_name }}
                  <span v-if="review.purchased_variant_name" class="crm-review-variant">
                    · {{ review.purchased_variant_name }}
                  </span>
                </p>

                <p class="crm-review-author">
                  {{ review.first_name || "Без имени" }}
                  <span v-if="review.telegram_username" class="crm-review-username">
                    @{{ review.telegram_username }}
                  </span>
                  <span v-else class="crm-review-notelegram">нет Telegram</span>
                </p>
              </div>

              <div class="crm-review-aside">
                <div class="crm-review-stars" :aria-label="`${review.rating} из 5`">
                  <span v-for="star in 5" :key="star" :class="{ 'is-off': star > review.rating }">★</span>
                </div>
                <time v-if="review.created_at" class="crm-review-date">
                  {{ formatReviewDate(review.created_at) }}
                </time>
              </div>
            </header>

            <!-- Текст отзыва читается как цитата на светлой подложке. -->
            <blockquote class="crm-review-body">
              <template v-if="review.body_text?.trim()">{{ review.body_text }}</template>
              <em v-else class="crm-review-body-empty">
                Клиент поставил оценку без комментария
              </em>
            </blockquote>

            <!-- Решение: одобрение — главное действие, отклонение тише. -->
            <footer class="crm-review-actions">
              <button
                type="button"
                class="crm-review-approve"
                :disabled="moderatingId === review.id"
                @click="requestModerate(review, 'approve')"
              >
                <svg
                  v-if="moderatingId !== review.id"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6.5 9.5 17 4 11.5" />
                </svg>
                <span v-else class="crm-review-spinner" aria-hidden="true" />
                {{ moderatingId === review.id ? "Сохраняем…" : "Одобрить" }}
              </button>

              <button
                type="button"
                class="crm-review-reject"
                :disabled="moderatingId === review.id"
                @click="requestModerate(review, 'reject')"
              >
                Отклонить
              </button>
            </footer>
          </article>
        </div>
      </section>

    </div>

    <!-- Confirm: модерация -->
    <Transition name="modal-fade">
      <div
        v-if="confirmModerate"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        v-safe-backdrop-close="() => (confirmModerate = null)"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reviews-confirm-moderate-title"
          @keydown.esc="confirmModerate = null"
        >
          <h3 id="reviews-confirm-moderate-title" class="mb-2 text-base font-semibold text-slate-900">
            {{ confirmModerate.action === "approve" ? "Одобрить отзыв?" : "Отклонить отзыв?" }}
          </h3>
          <p class="mb-4 text-sm text-slate-600">
            Заказ №{{ confirmModerate.review.order_number }}, {{ confirmModerate.review.group_name }}.
            {{ confirmModerate.action === "reject" ? "Отклонённый отзыв не появится у покупателей." : "Отзыв станет виден в каталоге." }}
          </p>
          <div class="flex justify-end gap-2">
            <CrmButton variant="ghost" size="sm" @click="confirmModerate = null">
              Отмена
            </CrmButton>
            <CrmButton
              :variant="confirmModerate.action === 'approve' ? 'success' : 'muted'"
              size="sm"
              @click="moderateConfirmed"
            >
              {{ confirmModerate.action === "approve" ? "Одобрить" : "Отклонить" }}
            </CrmButton>
          </div>
        </div>
      </div>
    </Transition>


    <Transition name="toast-slide">
      <div
        v-if="toast"
        class="fixed bottom-6 right-6 z-[70] flex max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg"
        :class="
          toast.kind === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : toast.kind === 'info'
              ? 'border border-blue-200 bg-blue-50 text-blue-800'
              : 'border border-red-200 bg-red-50 text-red-800'
        "
        :role="toast.kind === 'error' ? 'alert' : 'status'"
        :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'"
        aria-atomic="true"
      >
        <span class="flex-1 text-sm font-medium">{{ toast.text }}</span>
        <CrmButton
          variant="ghost"
          size="sm"
          icon-only
          aria-label="Закрыть"
          @click="dismissToast"
        >
          ✕
        </CrmButton>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import CrmButton from "@/components/admin/crm/CrmButton.vue";
import { useAdminStore } from "@/stores/admin";
import { useCrmStore } from "@/stores/crm";
import { vSafeBackdropClose } from "@/directives/safeBackdropClose";

/* Раздел остался один — модерация. Ответы, теги, розыгрыш и настройки
   убраны: задержек между отзывами больше нет, а вместо розыгрыша будет
   кэшбэк (логику напишем позже). */
type ToastKind = "success" | "error" | "info";

interface ToastMessage {
  kind: ToastKind;
  text: string;
}

interface ReviewItem {
  id: string;
  order_id?: string;
  order_number?: string | number;
  group_name?: string;
  rating: number;
  body_text: string;
  first_name?: string;
  telegram_username?: string;
  purchased_variant_name?: string;
  manager_reply?: string | null;
  created_at?: string;
}

const adminStore = useAdminStore();
const crmStore = useCrmStore();

const loading = ref(false);
const moderatingId = ref<string | null>(null);

const pendingCount = ref(0);
const pendingReviews = ref<ReviewItem[]>([]);
const toast = ref<ToastMessage | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const confirmModerate = ref<{ review: ReviewItem; action: "approve" | "reject" } | null>(null);


/**
 * Цвет оценки в карточке: низкие оценки должны бросаться в глаза,
 * высокие — читаться спокойно. Только оформление.
 */
function scoreClass(rating: number): string {
  if (rating <= 2) return "crm-review-score--low";
  if (rating === 3) return "crm-review-score--mid";
  return "crm-review-score--high";
}

function formatReviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


/* Только то, что может вернуть модерация: ответы, розыгрыш и
   настройки из раздела убраны. */
const API_ERROR_MESSAGES: Record<string, string> = {
  not_found: "Запись не найдена. Обновите список.",
  missing_fields: "Не все поля заполнены.",
  invalid_star_rating: "Оценка должна быть от 1 до 5.",
  failed: "Не удалось выполнить операцию. Попробуйте ещё раз.",
};


function showToast(kind: ToastKind, text: string) {
  toast.value = { kind, text };
  if (toastTimer) clearTimeout(toastTimer);
  if (kind !== "error") {
    toastTimer = setTimeout(() => {
      toast.value = null;
    }, 3500);
  }
}

function dismissToast() {
  toast.value = null;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

async function parseApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (data?.message && typeof data.message === "string" && !/^failed$/i.test(data.message)) {
    return data.message;
  }
  if (typeof data?.error === "string" && API_ERROR_MESSAGES[data.error]) {
    return API_ERROR_MESSAGES[data.error];
  }
  return fallback;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminStore.token}`,
  };
}


async function loadReviews() {
  loading.value = true;
  try {
    const [listRes, countRes] = await Promise.all([
      fetch("/api/admin/crm/product-reviews?status=pending", { headers: authHeaders() }),
      fetch("/api/admin/crm/product-reviews/pending-count", { headers: authHeaders() }),
    ]);

    if (!listRes.ok) {
      showToast("error", await parseApiError(listRes, "Не удалось загрузить очередь модерации."));
    } else {
      const data = await listRes.json();
      pendingReviews.value = data.items || [];
    }

    if (countRes.ok) {
      const data = await countRes.json();
      pendingCount.value = Number(data.count || 0);
      crmStore.markReviewsAsSeen();
    }
  } finally {
    loading.value = false;
  }
}

function requestModerate(review: ReviewItem, action: "approve" | "reject") {
  confirmModerate.value = { review, action };
}

async function moderateConfirmed() {
  const payload = confirmModerate.value;
  if (!payload) return;
  confirmModerate.value = null;

  const { review, action } = payload;
  moderatingId.value = review.id;
  try {
    const response = await fetch(`/api/admin/crm/product-reviews/${review.id}/${action}`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) {
      showToast("error", await parseApiError(response, "Не удалось обновить статус отзыва."));
      return;
    }
    showToast(
      "success",
      action === "approve"
        ? `Отзыв к заказу №${review.order_number} одобрен.`
        : `Отзыв к заказу №${review.order_number} отклонён.`,
    );
    // Обновляем очередь: одобренный отзыв уходит из неё, а счётчик
    // в шапке пересчитывается.
    await loadReviews();
  } finally {
    moderatingId.value = null;
  }
}


onMounted(async () => {
  // Раздел один: грузим очередь модерации и счётчик.
  await loadReviews();
});

onUnmounted(() => {
  dismissToast();
});
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.2s ease;
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

/* ===== Страница отзывов в языке CRM =====
   Чернильный текст, мягкие карточки с тенью, синий градиент на главном
   действии — как на эталонной странице заказов. */
.crm-reviews-page {
  --crm-reference-primary: linear-gradient(100deg, #05b8ff, #185dff);

  min-width: 0;
  width: 100%;
  color: #081b4b;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}

.crm-reviews-content {
  width: 100%;
  max-width: none;
}

.crm-reviews-page * {
  box-sizing: border-box;
}

/* Стандарт CRM: фокус видно на любом интерактивном элементе. */
.crm-reviews-page button:focus-visible,
.crm-reviews-page a:focus-visible {
  outline: 2px solid #0958ff;
  outline-offset: 3px;
}

.crm-reviews-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.crm-reviews-title {
  margin: 0;
  color: #081b4b;
  font-size: 37px;
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.crm-reviews-subtitle {
  margin: 8px 0 0;
  color: #7584a7;
  font-size: 13px;
  line-height: 1.5;
}

/* Счётчик очереди — заметный акцент в шапке. */
.crm-reviews-counter {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  flex-shrink: 0;
  padding: 11px 18px;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(115deg, #ff685a, #fa104f);
  color: #ffffff;
  font-family: inherit;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 8px 18px #fa104f38;
}

.crm-reviews-counter span {
  font-size: 11px;
  font-weight: 650;
  opacity: 0.9;
}

.crm-reviews-panel {
  padding: 22px;
  border-radius: 19px;
  background: #ffffff;
  box-shadow: 0 12px 35px #20386908;
}

.crm-reviews-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.crm-reviews-panel-head h2 {
  margin: 0;
  color: #081b4b;
  font-size: 17px;
  font-weight: 700;
}

.crm-reviews-hint {
  margin: 8px 0 0;
  color: #8898b5;
  font-size: 11px;
  line-height: normal;
}

.crm-reviews-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 34px 0;
  color: #7584a7;
  font-size: 13px;
}

/* Пустое состояние — как в эталоне: пунктир и круглая иконка. */
.crm-reviews-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 34px 18px;
  border: 1px dashed #dce6f4;
  border-radius: 13px;
  color: #8493b0;
  font-size: 12px;
  line-height: normal;
  text-align: center;
}

.crm-reviews-empty-symbol {
  display: grid;
  place-items: center;
  width: 57px;
  height: 57px;
  margin-bottom: 2px;
  border-radius: 50%;
  background: #f4f7fd;
  color: #4d6089;
}

.crm-reviews-empty-symbol svg {
  width: 26px;
  height: 26px;
}

.crm-reviews-empty b {
  color: #64799e;
  font-size: 13px;
}

.crm-reviews-empty > span:last-child {
  max-width: 260px;
}

.crm-reviews-queue {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}

.crm-reviews-queue--busy {
  pointer-events: none;
  opacity: 0.6;
}

.crm-review-card {
  display: grid;
  gap: 12px;
  padding: 16px 18px 14px;
  border: 1px solid #eaf0f9;
  /* 19px — радиус карточек в стандарте CRM (как у колонок доски). */
  border-radius: 19px;
  background: #ffffff;
  box-shadow: 0 10px 30px #20386908;
  transition: box-shadow 0.16s ease, border-color 0.16s ease;
}

.crm-review-card:hover {
  border-color: #dbe6f7;
  box-shadow: 0 14px 36px #20386912;
}

.crm-review-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

/* Крупная оценка — главный акцент карточки. */
.crm-review-score {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  align-content: center;
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  /* 13px — стандартный радиус интерактивных элементов CRM. */
  border-radius: 13px;
  color: #ffffff;
}

.crm-review-score b {
  font-size: 24px;
  font-weight: 800;
  line-height: 1;
}

.crm-review-score-max {
  font-size: 11px;
  font-weight: 650;
  opacity: 0.75;
}

.crm-review-score--high {
  background: linear-gradient(135deg, #18b86d, #0f9b58);
  box-shadow: 0 8px 16px #18b86d35;
}

.crm-review-score--mid {
  background: linear-gradient(135deg, #ffb020, #ff7a1a);
  box-shadow: 0 8px 16px #ff9a1f35;
}

.crm-review-score--low {
  background: linear-gradient(115deg, #ff685a, #fa104f);
  box-shadow: 0 8px 16px #fa104f35;
}

.crm-review-who {
  flex: 1;
  min-width: 0;
}

.crm-review-order {
  display: inline-block;
  color: #1759ed;
  font-size: 12px;
  font-weight: 750;
  line-height: normal;
  text-decoration: none;
}

.crm-review-order:hover {
  text-decoration: underline;
}

.crm-review-order--plain {
  color: #081b4b;
}

.crm-review-product {
  margin: 6px 0 0;
  color: #081b4b;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.crm-review-variant {
  color: #7584a7;
  font-weight: 600;
}

.crm-review-author {
  margin: 4px 0 0;
  color: #7584a7;
  font-size: 11px;
  line-height: normal;
}

.crm-review-username {
  color: #1759ed;
  font-weight: 650;
}

.crm-review-notelegram {
  color: #9ba8c0;
}

.crm-review-aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  flex-shrink: 0;
}

.crm-review-stars {
  display: flex;
  gap: 2px;
  color: #ffb020;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
}

.crm-review-stars .is-off {
  color: #dbe3ef;
}

.crm-review-date {
  color: #9ba8c0;
  font-size: 11px;
  line-height: normal;
  white-space: nowrap;
}

.crm-review-body {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f7faff;
  color: #102456;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.crm-review-body-empty {
  color: #9ba8c0;
}

.crm-review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.crm-review-approve,
.crm-review-reject {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 43px;
  padding: 13px 21px;
  border: 0;
  border-radius: 12px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 750;
  line-height: normal;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.crm-review-approve {
  min-width: 160px;
  background: var(--crm-reference-primary);
  color: #ffffff;
  box-shadow: 0 8px 16px #148cff30;
}

.crm-review-approve svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.crm-review-reject {
  background: linear-gradient(#f7faff, #e9f0fa);
  color: #233e70;
}

.crm-review-approve:hover:not(:disabled),
.crm-review-reject:hover:not(:disabled) {
  filter: brightness(1.04);
}

.crm-review-approve:disabled,
.crm-review-reject:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.crm-review-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: crm-reviews-spin 0.7s linear infinite;
}

@keyframes crm-reviews-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1120px) {
  .crm-reviews-title {
    font-size: 30px;
  }
}

@media (max-width: 700px) {
  .crm-reviews-head {
    flex-direction: column;
    gap: 12px;
  }

  .crm-reviews-title {
    font-size: 30px;
  }

  .crm-review-head {
    flex-wrap: wrap;
  }

  .crm-review-aside {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
  }

  .crm-review-actions > button {
    flex: 1 1 auto;
    min-width: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .crm-review-card,
  .crm-review-approve,
  .crm-review-reject {
    transition: none;
  }

  .crm-review-spinner {
    animation: none;
  }
}

</style>
