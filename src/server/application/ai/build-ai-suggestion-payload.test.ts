import { describe, expect, it } from "vitest";
import { buildAiSuggestionPayload, aiSuggestionPayloadLimits } from "@/server/application/ai/build-ai-suggestion-payload";

describe("buildAiSuggestionPayload", () => {
  it("applies truncation rules and keeps deterministic fallback metadata", () => {
    const payload = buildAiSuggestionPayload({
      review: {
        reviewId: "review-1",
        title: "A".repeat(400),
        repositoryName: "duck8823/locus",
        branchLabel: "feature/ai-suggestions",
      },
      selectedGroup: {
        groupId: "group-1",
        title: "Group 1",
        filePath: "src/demo.ts",
        semanticChanges: Array.from({ length: aiSuggestionPayloadLimits.maxSemanticChanges + 3 }, (_, index) => ({
          semanticChangeId: `sc-${index}`,
          symbolDisplayName: `symbol-${index}`,
          symbolKind: "function",
          changeType: "modified",
          signatureSummary: `signature-${index}`,
          bodySummary: `body-${index}`,
          before: {
            filePath: "src/demo.ts",
            startLine: 10 + index,
            endLine: 12 + index,
          },
          after: {
            filePath: "src/demo.ts",
            startLine: 20 + index,
            endLine: 22 + index,
          },
        })),
        architectureGraph: {
          nodes: [
            {
              nodeId: "group:group-1",
              kind: "file",
              label: "src/demo.ts",
              role: "center",
            },
            ...Array.from({ length: aiSuggestionPayloadLimits.maxArchitectureNodesPerDirection + 4 }, (_, index) => ({
              nodeId: `upstream:${index}`,
              kind: "symbol" as const,
              label: `upstream-${index}`,
              role: "upstream" as const,
            })),
          ],
          edges: Array.from({ length: aiSuggestionPayloadLimits.maxArchitectureNodesPerDirection + 4 }, (_, index) => ({
            fromNodeId: `upstream:${index}`,
            toNodeId: "group:group-1",
          })),
        },
      },
      businessContextItems: Array.from({ length: aiSuggestionPayloadLimits.maxBusinessContextItems + 2 }, (_, index) => ({
        contextId: `ctx-${index}`,
        sourceType: "github_issue" as const,
        status: index === 0 ? "linked" : "candidate",
        confidence: index === 0 ? "high" : "medium",
        title: `context-${index}`,
        summary: `summary-${index}`,
        href: `https://example.test/${index}`,
      })),
    });

    expect(payload.review.title.length).toBeLessThanOrEqual(aiSuggestionPayloadLimits.maxTextLength);
    expect(payload.semanticContext.isTruncated).toBe(true);
    expect(payload.semanticContext.includedCount).toBe(aiSuggestionPayloadLimits.maxSemanticChanges);
    expect(payload.architectureContext.isTruncated).toBe(true);
    expect(payload.architectureContext.includedUpstreamCount).toBe(aiSuggestionPayloadLimits.maxArchitectureNodesPerDirection);
    expect(payload.businessContext.isTruncated).toBe(true);
    expect(payload.businessContext.includedCount).toBe(aiSuggestionPayloadLimits.maxBusinessContextItems);
  });

  it("returns explicit fallback messages when semantic or business context is missing", () => {
    const payload = buildAiSuggestionPayload({
      review: {
        reviewId: "review-2",
        title: "Fallback review",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/fallback",
      },
      selectedGroup: null,
      businessContextItems: [],
    });

    expect(payload.semanticContext.fallbackMessage).toBe(
      "No semantic changes were found for the selected group.",
    );
    expect(payload.architectureContext.fallbackMessage).toBe(
      "No selected change group. Use semantic summary for manual triage.",
    );
    expect(payload.businessContext.fallbackMessage).toBe("No business context links were found.");
  });
});
