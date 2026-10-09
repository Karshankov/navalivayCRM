import { describe, expect, it } from "vitest";
import {
  TAB_BAR_NOTCH_DEPTH_RATIO,
  REVIEW_DOCK_CART_GAP_PX,
  TAB_BAR_NOTCH_FLOOR_CSS,
  TAB_BAR_SHAPE_HEIGHT,
  computeReviewDockCartClearance,
  computeReviewDockExtrusion,
  parseTabBarHeightCss,
} from "@/utils/reviewDockGeometry";

describe("reviewDockGeometry", () => {
  describe("constants", () => {
    it("matches tab bar SVG notch floor geometry", () => {
      expect(TAB_BAR_NOTCH_DEPTH_RATIO).toBeCloseTo(34.26 / 130, 6);
      expect(TAB_BAR_NOTCH_FLOOR_CSS).toContain("95.74");
    });
  });

  describe("parseTabBarHeightCss", () => {
    it("parses valid pixel values", () => {
      expect(parseTabBarHeightCss("130px")).toBe(130);
      expect(parseTabBarHeightCss("  108.5px  ")).toBe(108.5);
    });

    it("falls back on invalid css values", () => {
      expect(parseTabBarHeightCss("")).toBe(TAB_BAR_SHAPE_HEIGHT);
      expect(parseTabBarHeightCss("auto")).toBe(TAB_BAR_SHAPE_HEIGHT);
      expect(parseTabBarHeightCss("0px")).toBe(TAB_BAR_SHAPE_HEIGHT);
      expect(parseTabBarHeightCss("-12px")).toBe(TAB_BAR_SHAPE_HEIGHT);
      expect(parseTabBarHeightCss("NaNpx")).toBe(TAB_BAR_SHAPE_HEIGHT);
    });

    it("uses custom fallback when provided", () => {
      expect(parseTabBarHeightCss("broken", 99)).toBe(99);
    });
  });

  describe("computeReviewDockExtrusion", () => {
    it("subtracts notch overlap from dock height at default tab bar size", () => {
      const overlap = TAB_BAR_SHAPE_HEIGHT * TAB_BAR_NOTCH_DEPTH_RATIO;
      expect(computeReviewDockExtrusion(52, TAB_BAR_SHAPE_HEIGHT)).toBe(
        Math.ceil(52 - overlap),
      );
    });

    it("returns zero when dock fits entirely inside notch overlap", () => {
      const overlap = TAB_BAR_SHAPE_HEIGHT * TAB_BAR_NOTCH_DEPTH_RATIO;
      expect(computeReviewDockExtrusion(Math.floor(overlap), TAB_BAR_SHAPE_HEIGHT)).toBe(0);
    });

    it("scales overlap with responsive tab bar height", () => {
      expect(computeReviewDockExtrusion(48, 108)).toBe(
        Math.ceil(48 - 108 * TAB_BAR_NOTCH_DEPTH_RATIO),
      );
    });
  });

  describe("computeReviewDockCartClearance", () => {
    it("measures dock top from viewport bottom with gap", () => {
      expect(computeReviewDockCartClearance(700, 800, REVIEW_DOCK_CART_GAP_PX)).toBe(
        800 - 700 + REVIEW_DOCK_CART_GAP_PX,
      );
    });

    it("never returns negative clearance", () => {
      expect(computeReviewDockCartClearance(900, 800, 10)).toBe(0);
      expect(computeReviewDockCartClearance(Number.NaN, 800, 10)).toBe(0);
      expect(computeReviewDockCartClearance(700, 0, 10)).toBe(0);
    });
  });

  describe("adversarial inputs", () => {
    it("never returns negative extrusion", () => {
      expect(computeReviewDockExtrusion(-10, 130)).toBe(0);
      expect(computeReviewDockExtrusion(0, 130)).toBe(0);
      expect(computeReviewDockExtrusion(10, -5)).toBe(10);
      expect(computeReviewDockExtrusion(Number.NaN, 130)).toBe(0);
      expect(computeReviewDockExtrusion(52, Number.NaN)).toBe(52);
      expect(computeReviewDockExtrusion(Number.POSITIVE_INFINITY, 130)).toBe(0);
    });

    it("ceil extrusion so layout reserve never truncates visible pixels", () => {
      expect(computeReviewDockExtrusion(52.2, 130)).toBe(
        Math.ceil(52.2 - 130 * TAB_BAR_NOTCH_DEPTH_RATIO),
      );
    });

    it("ignores absurd tab bar css strings", () => {
      expect(parseTabBarHeightCss("999999px")).toBe(999999);
      expect(parseTabBarHeightCss("1e3px")).toBe(1000);
      expect(parseTabBarHeightCss("130px; color: red")).toBe(130);
    });
  });
});