import { describe, expect, it } from "vitest";
import {
  isParentGroupLine,
  isReviewSubmissionGroup,
  shouldShowGroupReviewSummary,
} from "@/utils/groupReviewDisplay";

describe("groupReviewDisplay", () => {
  it("treats nodes with children as parent group lines", () => {
    expect(isParentGroupLine({ id: "brand", children: [{ id: "line" }] })).toBe(true);
    expect(isParentGroupLine({ id: "line", children: [] })).toBe(false);
  });

  it("allows review submission only on leaf lines", () => {
    expect(isReviewSubmissionGroup({ id: "brand", children: [{ id: "line" }] })).toBe(
      false,
    );
    expect(isReviewSubmissionGroup({ id: "duall", children: [] })).toBe(true);
  });

  it("shows review summary on parent and leaf rows", () => {
    expect(shouldShowGroupReviewSummary({ id: "brand", children: [{ id: "line" }] })).toBe(
      true,
    );
    expect(shouldShowGroupReviewSummary({ id: "duall", children: [] })).toBe(true);
  });
});