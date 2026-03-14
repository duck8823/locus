import type {
  BusinessContextItem,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";

const MIXED_CONTEXT_ITEMS: readonly BusinessContextItem[] = [
  {
    contextId: "ctx-gh-linked-101",
    sourceType: "github_issue",
    status: "linked",
    confidence: "high",
    inferenceSource: "repo_shorthand",
    title: "Linked issue: octocat/locus#101",
    summary: "GitHub-linked requirement.",
    href: "https://github.com/octocat/locus/issues/101",
  },
  {
    contextId: "ctx-jira-linked-321",
    sourceType: "github_issue",
    status: "linked",
    confidence: "high",
    inferenceSource: "none",
    title: "Jira ticket: LOC-321",
    summary: "Imported task ticket context.",
    href: "https://jira.example.com/browse/LOC-321",
  },
  {
    contextId: "ctx-confluence-linked-api",
    sourceType: "confluence_page",
    status: "linked",
    confidence: "medium",
    inferenceSource: "none",
    title: "API Contract Spec",
    summary: "Confluence requirement page.",
    href: "https://confluence.example.com/wiki/spaces/ENG/pages/12345/api-contract-spec",
  },
  {
    contextId: "ctx-gh-candidate-205",
    sourceType: "github_issue",
    status: "candidate",
    confidence: "high",
    inferenceSource: "branch_pattern",
    title: "Candidate issue: octocat/locus#205",
    summary: "Detected from branch naming.",
    href: "https://github.com/octocat/locus/issues/205",
  },
  {
    contextId: "ctx-jira-candidate-998",
    sourceType: "github_issue",
    status: "candidate",
    confidence: "medium",
    inferenceSource: "none",
    title: "Jira candidate: LOC-998",
    summary: "Imported candidate task ticket.",
    href: "https://jira.example.com/browse/LOC-998",
  },
  {
    contextId: "ctx-confluence-candidate-rollout",
    sourceType: "confluence_page",
    status: "candidate",
    confidence: "low",
    inferenceSource: "none",
    title: "Rollout plan draft",
    summary: "Potentially relevant spec draft.",
    href: "https://confluence.example.com/wiki/spaces/ENG/pages/34567/rollout-plan-draft",
  },
  {
    contextId: "ctx-gh-unavailable",
    sourceType: "github_issue",
    status: "unavailable",
    confidence: "low",
    inferenceSource: "none",
    title: "No additional GitHub issue context",
    summary: "No more links detected.",
    href: null,
  },
  {
    contextId: "ctx-confluence-unavailable",
    sourceType: "confluence_page",
    status: "unavailable",
    confidence: "low",
    inferenceSource: "none",
    title: "No additional Confluence context",
    summary: "No more pages detected.",
    href: null,
  },
];

function cloneItems(items: readonly BusinessContextItem[]): BusinessContextItem[] {
  return items.map((item) => ({ ...item }));
}

export function createMixedContextItemsFixture(): BusinessContextItem[] {
  return cloneItems(MIXED_CONTEXT_ITEMS);
}

export function createMixedContextItemsFixtureShuffled(): BusinessContextItem[] {
  return cloneItems([
    MIXED_CONTEXT_ITEMS[4],
    MIXED_CONTEXT_ITEMS[1],
    MIXED_CONTEXT_ITEMS[7],
    MIXED_CONTEXT_ITEMS[0],
    MIXED_CONTEXT_ITEMS[6],
    MIXED_CONTEXT_ITEMS[2],
    MIXED_CONTEXT_ITEMS[5],
    MIXED_CONTEXT_ITEMS[3],
  ]);
}

export function createMixedContextLiveSnapshotFixture(): BusinessContextSnapshot {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    provider: "github_live",
    diagnostics: {
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: ["freshness_priority", "provider_priority"],
    },
    items: createMixedContextItemsFixture(),
  };
}

export function createMixedContextFallbackSnapshotFixture(): BusinessContextSnapshot {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    provider: "stub",
    diagnostics: {
      cacheHit: true,
      fallbackReason: "stale_cache",
      conflictReasonCodes: ["confidence_priority"],
    },
    items: createMixedContextItemsFixture(),
  };
}
