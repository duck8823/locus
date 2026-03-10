import { describe, expect, it } from "vitest";
import { parseReanalyzeRequest } from "@/server/presentation/api/parse-reanalyze-request";

describe("parseReanalyzeRequest", () => {
  it("accepts null body as anonymous request", () => {
    expect(parseReanalyzeRequest(null)).toEqual({ requestedBy: null });
  });

  it("trims requestedBy when provided", () => {
    expect(
      parseReanalyzeRequest({
        requestedBy: "  reviewer-a  ",
      }),
    ).toEqual({ requestedBy: "reviewer-a" });
  });

  it("normalizes whitespace-only requestedBy to null", () => {
    expect(
      parseReanalyzeRequest({
        requestedBy: "   ",
      }),
    ).toEqual({ requestedBy: null });
  });

  it("rejects non-object body", () => {
    expect(() => parseReanalyzeRequest("invalid")).toThrow(
      "Reanalyze request body must be an object or null.",
    );
  });

  it("rejects non-string requestedBy", () => {
    expect(() =>
      parseReanalyzeRequest({
        requestedBy: 42,
      }),
    ).toThrow("requestedBy must be a string when provided.");
  });

  it("rejects excessively long requestedBy", () => {
    expect(() =>
      parseReanalyzeRequest({
        requestedBy: "a".repeat(121),
      }),
    ).toThrow("requestedBy must be at most 120 characters when provided.");
  });
});
