/**
 * Загрузка потока отзывов для панели.
 *
 * Источник — GET /api/reviews/feed: агрегат по одобренным отзывам и сами
 * отзывы, свежие сверху. Считает сервер, здесь только запрос и пагинация.
 *
 * Панель одна на всё приложение: на главной она показывает все отзывы,
 * а в карточке товара — только по этой линейке (параметр groupId).
 * Вид при этом одинаковый.
 */
import { ref, computed } from "vue";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

export interface ReviewsFeedReviewer {
  display_name: string;
  photo_url: string | null;
  is_anonymous: boolean;
  is_viewer: boolean;
}

export interface ReviewsFeedItem {
  id: string;
  rating: number;
  body_text: string;
  group_id: string | null;
  group_name: string | null;
  /** Обложка товара; null — у товара нет фото, показываем заглушку. */
  product_image_url: string | null;
  purchased_variant_name: string | null;
  reviewer: ReviewsFeedReviewer;
  created_at: string;
  approved_at: string | null;
}

export interface ReviewsFeedResponse {
  review_count: number;
  average_rating: number | null;
  items: ReviewsFeedItem[];
}

const PAGE_SIZE = 20;

export function useReviewsFeed(options: { groupId?: () => string | null } = {}) {
  const groupId = options.groupId;
  const items = ref<ReviewsFeedItem[]>([]);
  const reviewCount = ref(0);
  const averageRating = ref<number | null>(null);
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const errorMessage = ref("");
  const hasMore = ref(false);

  /** Средняя оценка с запятой — «4,9», как показывают в интерфейсе. */
  const averageLabel = computed(() => {
    const value = averageRating.value;
    if (value === null || Number.isNaN(value)) return "—";
    return value.toFixed(1).replace(".", ",");
  });

  /** «1 отзыв / 2 отзыва / 5 отзывов» — как принято в русском. */
  const countLabel = computed(() => {
    const n = reviewCount.value;
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} отзыв`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} отзыва`;
    return `${n} отзывов`;
  });

  async function fetchPage(offset: number, { append }: { append: boolean }) {
    const scopedGroup = groupId?.() || null;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (scopedGroup) params.set("group_id", scopedGroup);

    const response = await fetch(`/api/reviews/feed?${params.toString()}`, {
      headers: withTelegramAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить отзывы");
    }

    const data = (await response.json()) as ReviewsFeedResponse;
    reviewCount.value = Number(data.review_count || 0);
    averageRating.value =
      data.average_rating === null || data.average_rating === undefined
        ? null
        : Number(data.average_rating);

    items.value = append ? [...items.value, ...data.items] : data.items;
    hasMore.value = items.value.length < reviewCount.value;
  }

  async function load() {
    if (isLoading.value) return;
    isLoading.value = true;
    errorMessage.value = "";
    try {
      await fetchPage(0, { append: false });
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не удалось загрузить отзывы";
    } finally {
      isLoading.value = false;
    }
  }

  async function loadMore() {
    if (isLoading.value || isLoadingMore.value || !hasMore.value) return;
    isLoadingMore.value = true;
    try {
      await fetchPage(items.value.length, { append: true });
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Не удалось загрузить отзывы";
    } finally {
      isLoadingMore.value = false;
    }
  }

  return {
    items,
    reviewCount,
    averageRating,
    averageLabel,
    countLabel,
    isLoading,
    isLoadingMore,
    errorMessage,
    hasMore,
    load,
    loadMore,
  };
}
