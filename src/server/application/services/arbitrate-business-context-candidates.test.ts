import { describe, expect, it } from "vitest";
import {
  arbitrateBusinessContextCandidates,
  type BusinessContextArbitrationCandidate,
} from "@/server/application/services/arbitrate-business-context-candidates";

function buildCandidate(
  overrides: Partial<BusinessContextArbitrationCandidate> = {},
): BusinessContextArbitrationCandidate {
  const candidateId = overrides.candidateId ?? "candidate-1";
  const dedupeKey = overrides.dedupeKey ?? "key-1";

  return {
    candidateId,
    dedupeKey,
    provider: overrides.provider ?? "stub",
    confidence: overrides.confidence ?? "medium",
    status: overrides.status ?? "candidate",
    updatedAt: overrides.updatedAt ?? null,
    item: overrides.item ?? {
      contextId: candidateId,
      sourceType: "github_issue",
      status: overrides.status ?? "candidate",
      confidence: overrides.confidence ?? "medium",
      inferenceSource: "same_repo_shorthand",
      title: `Candidate ${candidateId}`,
      summary: null,
      href: `https://example.com/${dedupeKey}`,
    },
  };
}

describe("arbitrateBusinessContextCandidates", () => {
  it("prefers higher confidence when duplicate candidates collide", () => {
    const result = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "a",
        dedupeKey: "same",
        confidence: "medium",
      }),
      buildCandidate({
        candidateId: "b",
        dedupeKey: "same",
        confidence: "high",
      }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].contextId).toBe("b");
    expect(result.conflictReasonCodes).toEqual(["confidence_priority"]);
    expect(result.droppedCandidateIds).toEqual(["a"]);
  });

  it("prefers fresher candidate when confidence ties", () => {
    const result = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "stale",
        dedupeKey: "same",
        provider: "github",
        confidence: "high",
        updatedAt: "2026-03-10T10:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "fresh",
        dedupeKey: "same",
        provider: "github",
        confidence: "high",
        updatedAt: "2026-03-12T10:00:00.000Z",
      }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].contextId).toBe("fresh");
    expect(result.conflictReasonCodes).toEqual(["freshness_priority"]);
    expect(result.droppedCandidateIds).toEqual(["stale"]);
  });

  it("prefers provider priority when confidence and freshness tie", () => {
    const result = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "confluence",
        dedupeKey: "same",
        provider: "confluence",
        confidence: "high",
        updatedAt: "2026-03-12T10:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "jira",
        dedupeKey: "same",
        provider: "jira",
        confidence: "high",
        updatedAt: "2026-03-12T10:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "github",
        dedupeKey: "same",
        provider: "github",
        confidence: "high",
        updatedAt: "2026-03-12T10:00:00.000Z",
      }),
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].contextId).toBe("github");
    expect(result.conflictReasonCodes).toEqual(["provider_priority"]);
    expect(result.droppedCandidateIds).toEqual(["confluence", "jira"]);
  });

  it("uses stable tie-breaker for deterministic selection", () => {
    const firstRun = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "candidate-b",
        dedupeKey: "same",
        provider: "stub",
        confidence: "low",
        status: "candidate",
        updatedAt: null,
      }),
      buildCandidate({
        candidateId: "candidate-a",
        dedupeKey: "same",
        provider: "stub",
        confidence: "low",
        status: "candidate",
        updatedAt: null,
      }),
    ]);
    const secondRun = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "candidate-a",
        dedupeKey: "same",
        provider: "stub",
        confidence: "low",
        status: "candidate",
        updatedAt: null,
      }),
      buildCandidate({
        candidateId: "candidate-b",
        dedupeKey: "same",
        provider: "stub",
        confidence: "low",
        status: "candidate",
        updatedAt: null,
      }),
    ]);

    expect(firstRun.items[0].contextId).toBe("candidate-a");
    expect(secondRun.items[0].contextId).toBe("candidate-a");
    expect(firstRun.conflictReasonCodes).toEqual(["stable_tie_breaker"]);
    expect(secondRun.conflictReasonCodes).toEqual(["stable_tie_breaker"]);
  });

  it("handles mixed-provider groups and reports aggregated conflict reason codes", () => {
    const result = arbitrateBusinessContextCandidates([
      buildCandidate({
        candidateId: "gh-1",
        dedupeKey: "ticket-123",
        provider: "github",
        confidence: "high",
        status: "linked",
        updatedAt: "2026-03-12T12:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "jira-1",
        dedupeKey: "ticket-123",
        provider: "jira",
        confidence: "high",
        status: "linked",
        updatedAt: "2026-03-11T12:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "confluence-1",
        dedupeKey: "spec-doc",
        provider: "confluence",
        confidence: "medium",
        status: "linked",
        updatedAt: "2026-03-10T12:00:00.000Z",
      }),
      buildCandidate({
        candidateId: "stub-1",
        dedupeKey: "spec-doc",
        provider: "stub",
        confidence: "low",
        status: "candidate",
        updatedAt: null,
      }),
    ]);

    expect(result.items.map((item) => item.contextId)).toEqual(["gh-1", "confluence-1"]);
    expect(result.conflictReasonCodes).toEqual(["confidence_priority", "freshness_priority"]);
    expect(result.droppedCandidateIds).toEqual(["jira-1", "stub-1"]);
  });
});
