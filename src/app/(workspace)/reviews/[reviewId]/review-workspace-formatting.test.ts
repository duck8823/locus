import { describe, expect, it } from "vitest";
import {
  formatCodeRegion,
  formatAnalysisDuration,
  formatCoveragePercent,
  formatNullablePercent,
  compactTextItems,
  calculateAnalysisProgressPercent,
  buildArchitectureColumns,
  ARCHITECTURE_CATEGORY_ORDER,
} from "./review-workspace-formatting";

describe("formatCodeRegion", () => {
  it("returns dash for null region", () => {
    expect(formatCodeRegion(null)).toBe("—");
  });

  it("formats file path with line range", () => {
    expect(
      formatCodeRegion({ filePath: "src/index.ts", startLine: 10, endLine: 20 }),
    ).toBe("src/index.ts:10-20");
  });
});

describe("formatAnalysisDuration", () => {
  it("formats sub-second durations in ms", () => {
    expect(formatAnalysisDuration(500)).toBe("500 ms");
  });

  it("formats durations >= 1s in seconds", () => {
    expect(formatAnalysisDuration(2500)).toBe("2.5 s");
  });
});

describe("formatCoveragePercent", () => {
  it("formats whole percentages without decimal", () => {
    expect(formatCoveragePercent(100)).toBe("100%");
  });

  it("formats fractional percentages with one decimal", () => {
    expect(formatCoveragePercent(85.7)).toBe("85.7%");
  });
});

describe("formatNullablePercent", () => {
  it("returns dash for null", () => {
    expect(formatNullablePercent(null)).toBe("—");
  });

  it("formats valid number", () => {
    expect(formatNullablePercent(42.0)).toBe("42%");
  });
});

describe("compactTextItems", () => {
  it("filters null, undefined, and empty strings", () => {
    expect(compactTextItems(["a", null, undefined, "", "b"])).toEqual(["a", "b"]);
  });
});

describe("calculateAnalysisProgressPercent", () => {
  it("returns null for invalid inputs", () => {
    expect(calculateAnalysisProgressPercent({ analysisProcessedFiles: null, analysisTotalFiles: null })).toBeNull();
    expect(calculateAnalysisProgressPercent({ analysisProcessedFiles: 5, analysisTotalFiles: 0 })).toBeNull();
  });

  it("calculates progress percentage", () => {
    expect(calculateAnalysisProgressPercent({ analysisProcessedFiles: 5, analysisTotalFiles: 10 })).toBe(50);
  });

  it("caps at 100%", () => {
    expect(calculateAnalysisProgressPercent({ analysisProcessedFiles: 15, analysisTotalFiles: 10 })).toBe(100);
  });
});

describe("buildArchitectureColumns", () => {
  it("returns upstream and downstream columns", () => {
    const columns = buildArchitectureColumns(
      {
        nodes: [
          { nodeId: "a", role: "center", label: "A", linkedGroupId: null },
          { nodeId: "b", role: "peer", label: "B", linkedGroupId: "g1" },
          { nodeId: "c", role: "peer", label: "C", linkedGroupId: "g2" },
        ],
        edges: [
          { fromNodeId: "b", toNodeId: "a", relation: "imports" },
          { fromNodeId: "a", toNodeId: "c", relation: "calls" },
        ],
      },
      "test-group",
    );

    expect(columns).toHaveLength(2);
    expect(columns[0].label).toBe("upstream");
    expect(columns[0].nodes).toHaveLength(1);
    expect(columns[0].nodes[0].nodeId).toBe("b");
    expect(columns[1].label).toBe("downstream");
    expect(columns[1].nodes).toHaveLength(1);
    expect(columns[1].nodes[0].nodeId).toBe("c");
  });
});

describe("ARCHITECTURE_CATEGORY_ORDER", () => {
  it("contains expected categories", () => {
    expect(ARCHITECTURE_CATEGORY_ORDER).toEqual(["layer", "file", "symbol", "unknown"]);
  });
});
