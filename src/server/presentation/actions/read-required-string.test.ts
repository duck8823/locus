import { describe, expect, it } from "vitest";
import { readRequiredString } from "@/server/presentation/actions/read-required-string";

describe("readRequiredString", () => {
  it("returns trimmed string values", () => {
    const formData = new FormData();
    formData.set("reviewId", "  review-1  ");

    expect(readRequiredString(formData, "reviewId")).toBe("review-1");
  });

  it("throws when value is missing", () => {
    const formData = new FormData();

    expect(() => readRequiredString(formData, "reviewId")).toThrow("reviewId is required.");
  });

  it("throws when value is whitespace-only", () => {
    const formData = new FormData();
    formData.set("reviewId", "   ");

    expect(() => readRequiredString(formData, "reviewId")).toThrow("reviewId is required.");
  });

  it("throws when value is not a string", () => {
    const formData = new FormData();
    formData.set("reviewId", new File(["x"], "review.txt", { type: "text/plain" }));

    expect(() => readRequiredString(formData, "reviewId")).toThrow("reviewId is required.");
  });
});
