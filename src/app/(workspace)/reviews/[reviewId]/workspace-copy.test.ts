import { describe, expect, it } from "vitest";
import {
  formatArchitectureColumnLabel,
  formatReviewGroupStatus,
  formatSemanticChangeType,
  formatSemanticSymbolKind,
  formatUnsupportedReason,
} from "./workspace-copy";

describe("workspace-copy", () => {
  it("formats review-group and semantic labels in japanese", () => {
    expect(formatReviewGroupStatus("in_progress", "ja")).toBe("確認中");
    expect(formatSemanticChangeType("renamed", "ja")).toBe("改名");
    expect(formatSemanticSymbolKind("method", "ja")).toBe("メソッド");
    expect(formatUnsupportedReason("parser_failed", "ja")).toBe("パーサー失敗");
    expect(formatArchitectureColumnLabel("upstream", "ja")).toBe("上流");
  });
});
