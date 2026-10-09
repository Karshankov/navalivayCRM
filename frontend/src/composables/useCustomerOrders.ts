import { ref } from "vue";
import { withTelegramAuthHeaders } from "@/utils/telegramAuth";

export interface ReviewPrompt {
  show: boolean;
  reason?: string;
  order_id?: string;
  order_number?: number;
  group_id?: string;
  group_name?: string;
  purchased_variant_name?: string | null;
  pending_review_count?: number;
  preview_icons?: OrderHistoryCategoryIcon[];
  preview_icons_overflow?: number;
  lottery_hint_text?: string;
  preferences?: ReviewPreferences;
}

export interface OrderHistoryCategoryIcon {
  category_id: string | null;
  group_id?: string | null;
  category_name: string | null;
  group_name?: string | null;
  image: string | null;
}

export interface OrderFulfillmentMilestones {
  submitted_at: string | null;
  ready_at: string | null;
  issued_at: string | null;
  cancelled_at?: string | null;
}

export interface OrderHistoryItem {
  id: string;
  order_number: number;
  status: string;
  delivery_type?: string | null;
  created_at: string;
  completed_at: string | null;
  final_amount: number;
  category_icons: OrderHistoryCategoryIcon[];
  category_icons_overflow: number;
  fulfillment_milestones?: OrderFulfillmentMilestones | null;
  review_hint?: string | null;
}

export interface OrderHistoryResponse {
  items: OrderHistoryItem[];
  next_cursor: string | null;
}

export interface ReviewEligibility {
  canReview: boolean;
  reason: string;
  cooldownEndsAt?: string;
  reviewId?: string;
  existingReview?: {
    id: string;
    status: string;
    rating: number;
    created_at: string;
  };
  orderId?: string;
  orderItemId?: string;
  purchasedVariantId?: string | null;
  purchasedVariantName?: string | null;
}

export interface ReviewableLineItem {
  id: string;
  product_id: string;
  product_title: string;
  base_product_title: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  total_price: number;
  image: string | null;
}

export interface ReviewableLine {
  group_id: string;
  group_name: string;
  category_id: string | null;
  category_name: string | null;
  category_cover_image: string | null;
  group_cover_image: string | null;
  review_category_key: string;
  order_item_id: string | null;
  purchased_variant_id: string | null;
  purchased_variant_name: string | null;
  items: ReviewableLineItem[];
  eligibility: ReviewEligibility;
  latest_review: {
    id: string;
    status: string;
    rating: number;
    created_at: string;
  } | null;
}

export interface OrderDetail {
  id: string;
  order_number: number;
  status: string;
  delivery_type: string;
  delivery_address: string | null;
  phone: string | null;
  notes: string | null;
  total_amount: number;
  discount_amount: number;
  final_amount: number;
  promo_code_text: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  fulfillment_milestones?: OrderFulfillmentMilestones | null;
  reviewable_lines: ReviewableLine[];
  lottery_hint_text: string;
}

export interface QuickTag {
  id: string;
  label: string;
  insert_text: string;
  sort_order: number;
}

export interface SubmitReviewPayload {
  order_id: string;
  group_id: string;
  order_item_id?: string | null;
  rating: number;
  body_text: string;
  quick_tag_ids?: string[];
  is_anonymous?: boolean;
}

export interface SubmitReviewResult {
  ok: boolean;
  review: {
    id: string;
    status: string;
    rating: number;
    body_text: string;
    is_anonymous: number;
    created_at: string;
  };
}

export interface ReviewPreferences {
  reviews_opt_out: boolean;
  reviews_prefer_anonymous: boolean;
}

export interface GroupReviewReviewer {
  display_name: string;
  photo_url: string | null;
  is_anonymous: boolean;
  is_viewer?: boolean;
}

export interface ManagerReviewBlock {
  display_name: string;
  avatar_url: string;
}

export interface GroupReviewItem {
  id: string;
  rating: number;
  body_text: string;
  purchased_variant_name: string | null;
  quick_tag_labels: string[];
  reviewer: GroupReviewReviewer;
  manager_reply: string | null;
  manager_replied_at: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface GroupReviewsResponse {
  group_id: string;
  review_count: number;
  average_rating: number | null;
  manager: ManagerReviewBlock;
  items: GroupReviewItem[];
}

const reviewPrompt = ref<ReviewPrompt | null>(null);
const reviewPreferences = ref<ReviewPreferences>({
  reviews_opt_out: false,
  reviews_prefer_anonymous: false,
});

let inflightPrompt: Promise<ReviewPrompt> | null = null;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (data as { message?: string }).message ||
      (data as { error?: string }).error ||
      "Не удалось выполнить запрос";
    throw new Error(message);
  }
  return data as T;
}

export function useCustomerOrders() {
  async function fetchReviewPrompt(): Promise<ReviewPrompt> {
    if (inflightPrompt) return inflightPrompt;

    inflightPrompt = (async () => {
      const response = await fetch("/api/reviews/prompt", {
        headers: withTelegramAuthHeaders(),
      });
      const data = await parseJsonResponse<ReviewPrompt>(response);
      reviewPrompt.value = data;

      if (data.preferences) {
        reviewPreferences.value = {
          reviews_opt_out: Boolean(data.preferences.reviews_opt_out),
          reviews_prefer_anonymous: Boolean(data.preferences.reviews_prefer_anonymous),
        };
      } else if (data.reason === "opt_out") {
        reviewPreferences.value = {
          ...reviewPreferences.value,
          reviews_opt_out: true,
        };
      }

      return data;
    })().finally(() => {
      inflightPrompt = null;
    });

    return inflightPrompt;
  }

  async function fetchOrderHistory(options: {
    cursor?: string | null;
    limit?: number;
  } = {}): Promise<OrderHistoryResponse> {
    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit) params.set("limit", String(options.limit));

    const query = params.toString();
    const response = await fetch(
      `/api/orders/my-history${query ? `?${query}` : ""}`,
      { headers: withTelegramAuthHeaders() },
    );
    return parseJsonResponse<OrderHistoryResponse>(response);
  }

  async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
    const response = await fetch(
      `/api/orders/${encodeURIComponent(orderId)}/detail`,
      { headers: withTelegramAuthHeaders() },
    );
    return parseJsonResponse<OrderDetail>(response);
  }

  async function fetchQuickTags(
    categoryKey: string,
    starRating: number,
  ): Promise<QuickTag[]> {
    const params = new URLSearchParams({
      category_key: categoryKey,
      star_rating: String(starRating),
    });
    const response = await fetch(`/api/reviews/quick-tags?${params}`, {
      headers: withTelegramAuthHeaders(),
    });
    const data = await parseJsonResponse<{ items: QuickTag[] }>(response);
    return data.items || [];
  }

  async function submitReview(
    payload: SubmitReviewPayload,
  ): Promise<SubmitReviewResult> {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: withTelegramAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });
    const result = await parseJsonResponse<SubmitReviewResult>(response);

    // Refresh prompt after successful submission.
    void fetchReviewPrompt().catch(() => undefined);

    return result;
  }

  async function updateReviewPreferences(
    prefs: Partial<ReviewPreferences>,
  ): Promise<ReviewPreferences> {
    const response = await fetch("/api/profile/review-preferences", {
      method: "PATCH",
      headers: withTelegramAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(prefs),
    });
    const data = await parseJsonResponse<{
      ok: boolean;
      reviews_opt_out: boolean;
      reviews_prefer_anonymous: boolean;
    }>(response);

    reviewPreferences.value = {
      reviews_opt_out: Boolean(data.reviews_opt_out),
      reviews_prefer_anonymous: Boolean(data.reviews_prefer_anonymous),
    };

    if (reviewPreferences.value.reviews_opt_out) {
      reviewPrompt.value = { show: false, reason: "opt_out" };
    } else {
      void fetchReviewPrompt().catch(() => undefined);
    }

    return reviewPreferences.value;
  }

  async function fetchGroupReviews(
    groupId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<GroupReviewsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));

    const query = params.toString();
    const response = await fetch(
      `/api/groups/${encodeURIComponent(groupId)}/reviews${query ? `?${query}` : ""}`,
      { headers: withTelegramAuthHeaders() },
    );
    return parseJsonResponse<GroupReviewsResponse>(response);
  }

  async function fetchGroupReviewSummary(
    groupId: string,
  ): Promise<Pick<GroupReviewsResponse, "review_count" | "average_rating">> {
    const data = await fetchGroupReviews(groupId, { limit: 1, offset: 0 });
    return {
      review_count: data.review_count,
      average_rating: data.average_rating,
    };
  }

  return {
    reviewPrompt,
    reviewPreferences,
    fetchReviewPrompt,
    fetchOrderHistory,
    fetchOrderDetail,
    fetchQuickTags,
    submitReview,
    updateReviewPreferences,
    fetchGroupReviews,
    fetchGroupReviewSummary,
  };
}

export interface OrderSummaryThumb {
  key: string;
  image: string | null;
  label: string | null;
}

export function buildOrderSummaryFromLines(
  lines: Array<{
    group_id: string;
    group_name: string;
    category_id: string | null;
    category_name: string | null;
    group_cover_image: string | null;
    category_cover_image: string | null;
  }>,
  maxVisible = 4,
): {
  title: string;
  thumbs: OrderSummaryThumb[];
  overflow: number;
} {
  const seen = new Set<string>();
  const thumbs: OrderSummaryThumb[] = [];

  for (const line of lines) {
    const categoryName = line.category_name?.trim();

    const key = line.group_id || line.category_id;
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    thumbs.push({
      key,
      image: line.group_cover_image || line.category_cover_image || null,
      label: categoryName || line.group_name || null,
    });
  }

  const overflow = Math.max(0, thumbs.length - maxVisible);
  const visibleThumbs = thumbs.slice(0, maxVisible);

  return {
    title: formatOrderCardTitle(
      visibleThumbs.map((thumb) => ({ category_name: thumb.label })),
      overflow,
    ),
    thumbs: visibleThumbs,
    overflow,
  };
}

export function formatOrderCardTitle(
  icons: Array<{ category_name?: string | null }>,
  overflow = 0,
): string {
  const names = [
    ...new Set(
      icons
        .map((icon) => icon.category_name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const totalCount = names.length + Math.max(0, overflow);

  if (totalCount === 0) return "Покупка";
  if (totalCount === 1) return names[0] || "Покупка";
  if (totalCount === 2 && names.length >= 2) return `${names[0]} · ${names[1]}`;
  return `${names[0] || "Покупка"} и ещё ${totalCount - 1}`;
}

export function formatOrderDetailTitle(
  completedAt: string | null | undefined,
  createdAt: string | null | undefined,
): string {
  const label = formatOrderDate(completedAt || createdAt);
  return label === "—" ? "Покупка" : label;
}

const ORDER_TIME_ZONE = "Europe/Minsk";

/** SQLite timestamps without timezone are stored in UTC; format in Europe/Minsk. */
export function parseOrderDateTime(value: string | null | undefined): Date {
  if (!value) return new Date(Number.NaN);
  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  const isoNormalized = trimmed.includes("T")
    ? `${trimmed}Z`
    : `${trimmed.replace(" ", "T")}Z`;
  return new Date(isoNormalized);
}

export function formatOrderStatus(
  status: string,
  deliveryType?: string | null,
): string {
  switch (status) {
    case "new":
      return "Новый";
    case "in_progress":
      return "Собран";
    case "delivered":
    case "completed":
      return deliveryType === "delivery" ? "Доставлен" : "Выдан";
    case "cancelled":
      return "Отменён";
    default:
      return status;
  }
}

export function formatOrderDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseOrderDateTime(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: ORDER_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatOrderDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseOrderDateTime(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: ORDER_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatOrderHistoryTitle(orderNumber: number): string {
  return `Заказ № ${orderNumber}`;
}

export function formatOrderHistoryMeta(order: {
  status: string;
  delivery_type?: string | null;
  created_at: string;
  completed_at?: string | null;
  fulfillment_milestones?: OrderFulfillmentMilestones | null;
}): string {
  const statusLabel = formatOrderStatus(order.status, order.delivery_type);
  const milestones = order.fulfillment_milestones;
  const when =
    order.status === "cancelled"
      ? milestones?.cancelled_at || order.created_at
      : milestones?.issued_at || order.completed_at || order.created_at;

  return `${statusLabel} ${formatOrderDateTime(when)}`;
}

export function buildFulfillmentTimelineLines(
  milestones: OrderFulfillmentMilestones | null | undefined,
  status: string,
  deliveryType?: string | null,
): Array<{ key: string; label: string; at: string }> {
  if (!milestones) return [];

  if (status === "cancelled") {
    const lines: Array<{ key: string; label: string; at: string }> = [];
    if (milestones.submitted_at) {
      lines.push({ key: "submitted", label: "Оформлен", at: milestones.submitted_at });
    }
    if (milestones.cancelled_at) {
      lines.push({ key: "cancelled", label: "Отменён", at: milestones.cancelled_at });
    }
    return lines;
  }

  const issuedLabel = deliveryType === "delivery" ? "Доставлен" : "Выдан";
  const lines: Array<{ key: string; label: string; at: string }> = [];

  if (milestones.submitted_at) {
    lines.push({ key: "submitted", label: "Оформлен", at: milestones.submitted_at });
  }
  if (milestones.ready_at) {
    lines.push({ key: "ready", label: "Собран", at: milestones.ready_at });
  }
  if (milestones.issued_at) {
    lines.push({ key: "issued", label: issuedLabel, at: milestones.issued_at });
  }

  return lines;
}
