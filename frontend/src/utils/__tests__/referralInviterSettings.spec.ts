import { describe, expect, it } from "vitest";
import {
  findInvalidDisallowedInviterUsernames,
  parseDisallowedInviterUsernames,
  validateDisallowedInviterUsernames,
} from "@/utils/referralInviterSettings";

describe("referral inviter settings", () => {
  it("accepts @, mixed case and batch separators without duplicates", () => {
    expect(parseDisallowedInviterUsernames(" @Admin_One, ADMIN_ONE; admin_two\nadmin_three "))
      .toEqual(["admin_one", "admin_two", "admin_three"]);
  });

  it("rejects malformed, Unicode-spoofed and oversized username lists", () => {
    for (const input of ["abcd", "админ_один", "root' OR 1=1", "a".repeat(33)]) {
      expect(validateDisallowedInviterUsernames(parseDisallowedInviterUsernames(input))).toBe(false);
    }
    expect(validateDisallowedInviterUsernames(Array.from({ length: 101 }, (_, i) => `admin_${i}`)))
      .toBe(false);
    expect(findInvalidDisallowedInviterUsernames(["valid_admin", "админ", "abcd"]))
      .toEqual(["админ", "abcd"]);
  });
});
