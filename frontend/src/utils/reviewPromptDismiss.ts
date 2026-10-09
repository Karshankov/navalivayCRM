const SESSION_KEY = "review_prompt_dismissed_order_id";

export function isReviewPromptDismissed(orderId: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === orderId;
}

export function markReviewPromptDismissed(orderId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, orderId);
}