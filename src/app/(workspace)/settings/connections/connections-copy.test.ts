import { describe, expect, it } from "vitest";
import {
  connectionsCopyByLocale,
  formatAuthMode,
  formatCapabilityFlag,
  formatConnectedAccountLabel,
  formatTransitionActor,
  resolveOAuthFeedback,
} from "./connections-copy";

function assertSameNestedKeys(left: Record<string, unknown>, right: Record<string, unknown>) {
  expect(Object.keys(left).sort()).toEqual(Object.keys(right).sort());

  for (const key of Object.keys(left)) {
    const leftValue = left[key];
    const rightValue = right[key];
    const leftIsObject = !!leftValue && typeof leftValue === "object" && !Array.isArray(leftValue);
    const rightIsObject = !!rightValue && typeof rightValue === "object" && !Array.isArray(rightValue);

    if (leftIsObject || rightIsObject) {
      expect(leftIsObject && rightIsObject).toBe(true);
      assertSameNestedKeys(
        leftValue as Record<string, unknown>,
        rightValue as Record<string, unknown>,
      );
    }
  }
}

describe("connections-copy", () => {
  it("keeps EN/JA copy tables in key parity", () => {
    assertSameNestedKeys(
      connectionsCopyByLocale.en as unknown as Record<string, unknown>,
      connectionsCopyByLocale.ja as unknown as Record<string, unknown>,
    );
  });

  it("localizes auth mode and capability labels from copy table", () => {
    expect(formatAuthMode("none", "en")).toBe("None");
    expect(formatAuthMode("none", "ja")).toBe("なし");
    expect(formatCapabilityFlag(true, "en")).toBe("Enabled");
    expect(formatCapabilityFlag(false, "ja")).toBe("未対応");
  });

  it("localizes empty connected account and transition actor labels", () => {
    expect(formatConnectedAccountLabel(null, "en")).toBe("None");
    expect(formatConnectedAccountLabel(null, "ja")).toBe("なし");
    expect(
      formatTransitionActor({
        actorType: "reviewer",
        actorId: "demo-reviewer",
        locale: "ja",
      }),
    ).toBe("レビュアー (demo-reviewer)");
  });

  it("resolves localized OAuth feedback messages", () => {
    expect(
      resolveOAuthFeedback({
        successCode: "github_connected",
        errorCode: null,
        locale: "en",
      }),
    ).toEqual({
      kind: "success",
      message: "GitHub connection completed.",
    });
    expect(
      resolveOAuthFeedback({
        successCode: null,
        errorCode: "oauth_callback_failed",
        locale: "ja",
      }),
    ).toEqual({
      kind: "error",
      message: "OAuth コールバック処理に失敗しました。再試行してください。",
    });
  });
});
