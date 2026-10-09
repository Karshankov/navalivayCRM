/** Matches BottomTabBar.vue surface viewBox (0 0 393 130). */
export const TAB_BAR_SHAPE_HEIGHT = 130;
export const TAB_BAR_NOTCH_FLOOR_Y = 34.26;
export const TAB_BAR_NOTCH_DEPTH_RATIO = TAB_BAR_NOTCH_FLOOR_Y / TAB_BAR_SHAPE_HEIGHT;
export const TAB_BAR_NOTCH_FLOOR_CSS =
  "clamp(92px, calc(100vw * 95.74 / 393), 96px)";

/** Extra breathing room between review dock top and floating cart button. */
export const REVIEW_DOCK_CART_GAP_PX = 18;

export function parseTabBarHeightCss(
  raw: string,
  fallback = TAB_BAR_SHAPE_HEIGHT,
): number {
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Height reserved above tab bar when dock sits in the notch valley. */
export function computeReviewDockExtrusion(
  dockHeight: number,
  tabBarHeight: number,
): number {
  if (!Number.isFinite(dockHeight) || dockHeight <= 0) return 0;
  if (!Number.isFinite(tabBarHeight) || tabBarHeight <= 0) {
    return Math.ceil(dockHeight);
  }

  const notchOverlap = tabBarHeight * TAB_BAR_NOTCH_DEPTH_RATIO;
  return Math.max(0, Math.ceil(dockHeight - notchOverlap));
}

/** Bottom offset for floating cart controls above the visible review dock. */
export function computeReviewDockCartClearance(
  dockTopViewportY: number,
  viewportHeight: number,
  gapPx = REVIEW_DOCK_CART_GAP_PX,
): number {
  if (!Number.isFinite(dockTopViewportY) || !Number.isFinite(viewportHeight)) {
    return 0;
  }
  if (viewportHeight <= 0) return 0;

  const dockTopFromBottom = viewportHeight - dockTopViewportY;
  if (!Number.isFinite(dockTopFromBottom) || dockTopFromBottom <= 0) return 0;
  return Math.ceil(dockTopFromBottom + gapPx);
}