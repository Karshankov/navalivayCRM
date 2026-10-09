export interface ReviewDockRouteContext {
  path: string;
  name?: string | null;
  params?: Record<string, unknown>;
}

export interface ReviewDockPromptContext {
  show?: boolean;
  order_id?: string | null;
}

/** Routes where the user is already in the order/review flow. */
const REVIEW_FLOW_ROUTE_NAMES = new Set(["order-history", "order-detail"]);

export function isReviewDockSuppressed(
  route: ReviewDockRouteContext,
  prompt?: ReviewDockPromptContext | null,
): boolean {
  if (route.name && REVIEW_FLOW_ROUTE_NAMES.has(route.name)) {
    return true;
  }

  const path = route.path;
  if (path === "/profile/orders" || path.startsWith("/profile/orders/")) {
    return true;
  }

  const orderId = route.params?.orderId;
  const promptOrderId = prompt?.order_id;
  if (orderId && promptOrderId && String(orderId) === String(promptOrderId)) {
    return true;
  }

  return false;
}

export function isReviewDockVisible(
  route: ReviewDockRouteContext,
  prompt?: ReviewDockPromptContext | null,
): boolean {
  if (!prompt?.show || !prompt.order_id) return false;
  return !isReviewDockSuppressed(route, prompt);
}

export function isReviewPromptModalVisible(
  route: ReviewDockRouteContext,
  prompt?: ReviewDockPromptContext | null,
  options?: { dismissed?: boolean },
): boolean {
  if (options?.dismissed) return false;
  if (route.path !== "/") return false;
  return isReviewDockVisible(route, prompt);
}