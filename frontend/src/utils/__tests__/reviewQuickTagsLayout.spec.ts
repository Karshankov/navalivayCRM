import { describe, expect, it } from "vitest";
import { resolveQuickTagsLayout } from "@/utils/reviewQuickTagsLayout";

describe("resolveQuickTagsLayout", () => {
  it("returns empty string for zero tags", () => {
    expect(resolveQuickTagsLayout(0)).toBe("");
  });

  it("uses equal grid classes for 1-4 tags", () => {
    expect(resolveQuickTagsLayout(1)).toBe("review-form__tags-list--grid-1");
    expect(resolveQuickTagsLayout(2)).toBe("review-form__tags-list--grid-2");
    expect(resolveQuickTagsLayout(3)).toBe("review-form__tags-list--grid-3");
    expect(resolveQuickTagsLayout(4)).toBe("review-form__tags-list--grid-4");
  });

  it("uses horizontal scroll for five or more tags", () => {
    expect(resolveQuickTagsLayout(5)).toBe("review-form__tags-list--scroll");
    expect(resolveQuickTagsLayout(8)).toBe("review-form__tags-list--scroll");
  });
});