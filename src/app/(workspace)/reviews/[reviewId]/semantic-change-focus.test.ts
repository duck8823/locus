import { describe, expect, it } from "vitest";
import { toSemanticChangeFocusView } from "./semantic-change-focus";

describe("toSemanticChangeFocusView", () => {
  it("formats contract-and-behavior focus and positive span delta", () => {
    const result = toSemanticChangeFocusView({
      locale: "en",
      changeType: "modified",
      bodySummary: "Signature and body changed",
      before: {
        startLine: 10,
        endLine: 12,
      },
      after: {
        startLine: 10,
        endLine: 15,
      },
    });

    expect(result.focusLabel).toBe("Both callable contract and behavior changed");
    expect(result.spanDeltaLabel).toBe("+3 lines");
  });

  it("formats behavior focus and no-span-change label in japanese", () => {
    const result = toSemanticChangeFocusView({
      locale: "ja",
      changeType: "modified",
      bodySummary: "Body changed",
      before: {
        startLine: 4,
        endLine: 8,
      },
      after: {
        startLine: 20,
        endLine: 24,
      },
    });

    expect(result.focusLabel).toBe("実装の振る舞いが変更されています");
    expect(result.spanDeltaLabel).toBe("行数差分なし");
  });

  it("uses removed focus and negative span delta when after region is missing", () => {
    const result = toSemanticChangeFocusView({
      locale: "en",
      changeType: "removed",
      bodySummary: "Callable removed",
      before: {
        startLine: 50,
        endLine: 54,
      },
      after: null,
    });

    expect(result.focusLabel).toBe("This callable was removed");
    expect(result.spanDeltaLabel).toBe("-5 lines");
  });

  it("returns null span label when both regions are absent", () => {
    const result = toSemanticChangeFocusView({
      locale: "ja",
      changeType: "renamed",
      bodySummary: null,
      before: null,
      after: null,
    });

    expect(result.focusLabel).toBe("名称が変更されています");
    expect(result.spanDeltaLabel).toBeNull();
  });

  it("covers added and moved focus labels with safe fallback for unknown summaries", () => {
    const added = toSemanticChangeFocusView({
      locale: "en",
      changeType: "added",
      bodySummary: "unknown delta",
      before: null,
      after: {
        startLine: 12,
        endLine: 15,
      },
    });
    const moved = toSemanticChangeFocusView({
      locale: "ja",
      changeType: "moved",
      bodySummary: null,
      before: {
        startLine: 3,
        endLine: 7,
      },
      after: {
        startLine: 30,
        endLine: 34,
      },
    });
    const unknownModified = toSemanticChangeFocusView({
      locale: "en",
      changeType: "modified",
      bodySummary: "some parser summary that is not classified",
      before: {
        startLine: 1,
        endLine: 1,
      },
      after: {
        startLine: 1,
        endLine: 1,
      },
    });

    expect(added.focusLabel).toBe("A new callable was introduced");
    expect(added.spanDeltaLabel).toBe("+4 lines");
    expect(moved.focusLabel).toBe("定義位置が移動しています");
    expect(moved.spanDeltaLabel).toBe("行数差分なし");
    expect(unknownModified.focusLabel).toBe("Callable implementation was updated");
    expect(unknownModified.spanDeltaLabel).toBe("No span change");
  });
});
