import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_REVIEWER_ID,
  resolveReviewerId,
} from "@/server/presentation/actions/reviewer-identity";

describe("resolveReviewerId", () => {
  it("returns trimmed reviewer id when cookie is set", () => {
    expect(resolveReviewerId("  duck8823  ")).toBe("duck8823");
  });

  it("falls back to anonymous when cookie is missing or blank", () => {
    expect(resolveReviewerId(undefined)).toBe(ANONYMOUS_REVIEWER_ID);
    expect(resolveReviewerId("   ")).toBe(ANONYMOUS_REVIEWER_ID);
  });
});
