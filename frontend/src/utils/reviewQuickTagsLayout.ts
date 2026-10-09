export function resolveQuickTagsLayout(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "review-form__tags-list--grid-1";
  if (count === 2) return "review-form__tags-list--grid-2";
  if (count === 3) return "review-form__tags-list--grid-3";
  if (count === 4) return "review-form__tags-list--grid-4";
  return "review-form__tags-list--scroll";
}