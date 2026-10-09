export function formatReviewAverage(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return "—";
  const rounded = Math.round(rating * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}