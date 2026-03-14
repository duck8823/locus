import type { BusinessContextItem } from "@/server/application/ports/business-context-provider";

export type BusinessContextCandidateProvider = "github" | "jira" | "confluence" | "stub";

export type BusinessContextConflictReasonCode =
  | "confidence_priority"
  | "freshness_priority"
  | "provider_priority"
  | "status_priority"
  | "stable_tie_breaker";

export interface BusinessContextArbitrationCandidate {
  candidateId: string;
  dedupeKey: string;
  provider: BusinessContextCandidateProvider;
  confidence: BusinessContextItem["confidence"];
  status: BusinessContextItem["status"];
  updatedAt: string | null;
  item: BusinessContextItem;
}

export interface BusinessContextArbitrationResult {
  items: BusinessContextItem[];
  conflictReasonCodes: BusinessContextConflictReasonCode[];
  droppedCandidateIds: string[];
}

const CONFIDENCE_PRIORITY: Record<BusinessContextItem["confidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STATUS_PRIORITY: Record<BusinessContextItem["status"], number> = {
  linked: 3,
  candidate: 2,
  unavailable: 1,
};

const PROVIDER_PRIORITY: Record<BusinessContextCandidateProvider, number> = {
  github: 4,
  jira: 3,
  confluence: 2,
  stub: 1,
};

function toFreshnessScore(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareCandidates(
  left: BusinessContextArbitrationCandidate,
  right: BusinessContextArbitrationCandidate,
): number {
  const confidenceDifference = CONFIDENCE_PRIORITY[right.confidence] - CONFIDENCE_PRIORITY[left.confidence];

  if (confidenceDifference !== 0) {
    return confidenceDifference;
  }

  const freshnessDifference = toFreshnessScore(right.updatedAt) - toFreshnessScore(left.updatedAt);

  if (freshnessDifference !== 0) {
    return freshnessDifference;
  }

  const providerDifference = PROVIDER_PRIORITY[right.provider] - PROVIDER_PRIORITY[left.provider];

  if (providerDifference !== 0) {
    return providerDifference;
  }

  const statusDifference = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];

  if (statusDifference !== 0) {
    return statusDifference;
  }

  return left.candidateId.localeCompare(right.candidateId);
}

function resolveConflictReasonCode(input: {
  winner: BusinessContextArbitrationCandidate;
  challenger: BusinessContextArbitrationCandidate;
}): BusinessContextConflictReasonCode {
  if (input.winner.confidence !== input.challenger.confidence) {
    return "confidence_priority";
  }

  if (toFreshnessScore(input.winner.updatedAt) !== toFreshnessScore(input.challenger.updatedAt)) {
    return "freshness_priority";
  }

  if (input.winner.provider !== input.challenger.provider) {
    return "provider_priority";
  }

  if (input.winner.status !== input.challenger.status) {
    return "status_priority";
  }

  return "stable_tie_breaker";
}

export function arbitrateBusinessContextCandidates(
  candidates: BusinessContextArbitrationCandidate[],
): BusinessContextArbitrationResult {
  const conflictReasonCodes = new Set<BusinessContextConflictReasonCode>();
  const droppedCandidateIds: string[] = [];
  const candidatesByDedupeKey = new Map<string, BusinessContextArbitrationCandidate[]>();

  candidates.forEach((candidate) => {
    const previous = candidatesByDedupeKey.get(candidate.dedupeKey);

    if (previous) {
      previous.push(candidate);
      return;
    }

    candidatesByDedupeKey.set(candidate.dedupeKey, [candidate]);
  });

  const winningCandidateIds = new Set<string>();

  for (const [, groupCandidates] of candidatesByDedupeKey) {
    if (groupCandidates.length === 1) {
      winningCandidateIds.add(groupCandidates[0].candidateId);
      continue;
    }

    const sortedCandidates = [...groupCandidates].sort(compareCandidates);
    const winner = sortedCandidates[0];
    const challenger = sortedCandidates[1];

    winningCandidateIds.add(winner.candidateId);
    conflictReasonCodes.add(
      resolveConflictReasonCode({
        winner,
        challenger,
      }),
    );

    for (const droppedCandidate of sortedCandidates.slice(1)) {
      droppedCandidateIds.push(droppedCandidate.candidateId);
    }
  }

  const items = candidates
    .filter((candidate) => winningCandidateIds.has(candidate.candidateId))
    .map((candidate) => candidate.item);

  return {
    items,
    conflictReasonCodes: [...conflictReasonCodes].sort(),
    droppedCandidateIds: droppedCandidateIds.sort(),
  };
}
