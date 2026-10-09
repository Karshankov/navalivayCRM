export interface ReviewDockCopyInput {
  order_number?: number | null;
  group_name?: string | null;
  purchased_variant_name?: string | null;
  pending_review_count?: number | null;
  lottery_hint_text?: string | null;
}

export function buildReviewDockTitle(groupName?: string | null): string {
  const trimmed = groupName?.trim();
  return trimmed || "Ваш заказ";
}

function shortLotteryHint(input: ReviewDockCopyInput): string {
  const lottery = input.lottery_hint_text?.trim();
  if (lottery) {
    const giftMatch = lottery.match(/(\d+)\s*подар/i);
    if (giftMatch) {
      return `${giftMatch[1]} подарков в конце месяца`;
    }
    if (lottery.length <= 36) return lottery;
    return "Розыгрыш подарков в конце месяца";
  }
  return "5 подарков в конце месяца";
}

export function buildReviewDockMetaLine(input: ReviewDockCopyInput): string {
  const orderNumber = input.order_number;
  const pending = Math.max(1, Number(input.pending_review_count || 1));
  const orderPart = orderNumber ? `Заказ №${orderNumber}` : "Ваш заказ";

  if (pending > 1) {
    const linesWord = pending >= 5 ? "линеек" : pending >= 2 ? "линейки" : "линейка";
    return `${orderPart} · ещё ${pending} ${linesWord} без отзыва`;
  }

  return `${orderPart} · ${shortLotteryHint(input)}`;
}

export function buildReviewDockIncentiveLine(input: ReviewDockCopyInput): string {
  const variant = input.purchased_variant_name?.trim();
  if (variant) return variant;
  return shortLotteryHint(input);
}