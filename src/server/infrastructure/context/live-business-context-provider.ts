import { createHash } from "node:crypto";
import type {
  BusinessContextItem,
  BusinessContextProvider,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";
import { LiveBusinessContextUnavailableError } from "@/server/application/errors/live-business-context-unavailable-error";
import {
  classifyIntegrationFailure,
  type IntegrationFailureClassification,
} from "@/server/application/services/classify-integration-failure";
import {
  arbitrateBusinessContextCandidates,
  type BusinessContextArbitrationCandidate,
  type BusinessContextCandidateProvider,
  type BusinessContextConflictReasonCode,
} from "@/server/application/services/arbitrate-business-context-candidates";
import type {
  IssueContextProvider,
  IssueContextRecord,
} from "@/server/application/ports/issue-context-provider";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";

interface GitHubIssueReference {
  owner: string;
  repository: string;
  issueNumber: number;
}

interface IndexedGitHubIssueReference extends GitHubIssueReference {
  itemIndex: number;
}

function toIssueReferenceKey(reference: GitHubIssueReference): string {
  return `${reference.owner.toLowerCase()}/${reference.repository.toLowerCase()}#${reference.issueNumber}`;
}

function toIssueCacheKey(input: {
  reference: GitHubIssueReference;
  accessToken: string | null;
}): string {
  if (!input.accessToken) {
    return `anon:${toIssueReferenceKey(input.reference)}`;
  }

  const tokenHash = createHash("sha256").update(input.accessToken).digest("hex");

  return `token:${tokenHash}:${toIssueReferenceKey(input.reference)}`;
}

function parseGitHubIssueReferenceFromHref(href: string | null): GitHubIssueReference | null {
  if (!href) {
    return null;
  }

  try {
    const parsedUrl = new URL(href);

    if (parsedUrl.hostname !== "github.com") {
      return null;
    }

    const [owner, repository, issueSegment, issueNumberSegment] =
      parsedUrl.pathname.split("/").filter(Boolean);
    const issueNumber = Number.parseInt(issueNumberSegment ?? "", 10);

    if (
      !owner ||
      !repository ||
      issueSegment !== "issues" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return null;
    }

    return {
      owner,
      repository,
      issueNumber,
    };
  } catch {
    return null;
  }
}

function collectIssueReferences(
  items: BusinessContextItem[],
): {
  indexedReferences: IndexedGitHubIssueReference[];
  uniqueReferences: GitHubIssueReference[];
} {
  const indexedReferences: IndexedGitHubIssueReference[] = [];
  const seenKeys = new Set<string>();
  const uniqueReferences: GitHubIssueReference[] = [];

  items.forEach((item, itemIndex) => {
    if (item.sourceType !== "github_issue") {
      return;
    }

    const parsedReference = parseGitHubIssueReferenceFromHref(item.href);

    if (!parsedReference) {
      return;
    }

    indexedReferences.push({
      ...parsedReference,
      itemIndex,
    });

    const referenceKey = toIssueReferenceKey(parsedReference);

    if (seenKeys.has(referenceKey)) {
      return;
    }

    seenKeys.add(referenceKey);
    uniqueReferences.push(parsedReference);
  });

  return {
    indexedReferences,
    uniqueReferences,
  };
}

function truncateInlineText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}…`;
}

function toLiveIssueSummary(issue: IssueContextRecord): string {
  const normalizedBody = issue.body?.replace(/\s+/g, " ").trim() ?? "";

  if (normalizedBody.length > 0) {
    return truncateInlineText(normalizedBody, 220);
  }

  const stateLabel = issue.state === "closed" ? "Closed issue" : "Open issue";
  const labelNames = issue.labels.map((label) => label.name).filter((name) => name.trim().length > 0);

  if (labelNames.length === 0) {
    return stateLabel;
  }

  return `${stateLabel} • labels: ${truncateInlineText(labelNames.join(", "), 140)}`;
}

function mergeLiveIssueIntoItem(
  item: BusinessContextItem,
  issue: IssueContextRecord,
): BusinessContextItem {
  return {
    ...item,
    title: issue.title,
    summary: toLiveIssueSummary(issue),
    href: issue.htmlUrl,
  };
}

function toContextDedupeKey(item: BusinessContextItem): string {
  if (item.href) {
    const trimmedHref = item.href.trim();

    if (trimmedHref.length > 0) {
      try {
        const parsed = new URL(trimmedHref);
        const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();
        const normalizedProtocol = parsed.protocol.toLowerCase();

        return `url:${normalizedProtocol}//${parsed.hostname.toLowerCase()}${normalizedPath}`;
      } catch {
        return `raw:${trimmedHref.toLowerCase()}`;
      }
    }
  }

  const normalizedTitle = item.title.trim().toLowerCase();

  if (normalizedTitle.length > 0) {
    return `title:${normalizedTitle}`;
  }

  return `context:${item.contextId}`;
}

function resolveCandidateProvider(input: {
  item: BusinessContextItem;
  isLiveEnriched: boolean;
}): BusinessContextCandidateProvider {
  if (input.item.sourceType === "confluence_page") {
    return "confluence";
  }

  if (input.isLiveEnriched) {
    return "github";
  }

  return "stub";
}

function mergeConflictReasonCodes(input: {
  fallbackConflictReasonCodes: readonly BusinessContextConflictReasonCode[];
  arbitrationConflictReasonCodes: readonly BusinessContextConflictReasonCode[];
}): BusinessContextConflictReasonCode[] {
  return [...new Set([...input.fallbackConflictReasonCodes, ...input.arbitrationConflictReasonCodes])];
}

interface CachedIssueEntry {
  issue: IssueContextRecord | null;
  cachedAtMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface LiveBusinessContextProviderOptions {
  issueContextProvider: IssueContextProvider;
  fallbackProvider?: BusinessContextProvider;
  cacheTtlMs?: number;
  staleCacheTtlMs?: number;
  maxCacheEntries?: number;
  maxFetchAttempts?: number;
  initialBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class LiveBusinessContextProvider implements BusinessContextProvider {
  private readonly issueContextProvider: IssueContextProvider;
  private readonly fallbackProvider: BusinessContextProvider;
  private readonly cacheTtlMs: number;
  private readonly staleCacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly maxFetchAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly issueCache = new Map<string, CachedIssueEntry>();

  constructor(options: LiveBusinessContextProviderOptions) {
    this.issueContextProvider = options.issueContextProvider;
    this.fallbackProvider = options.fallbackProvider ?? new StubBusinessContextProvider();
    this.cacheTtlMs = Math.max(0, Math.floor(options.cacheTtlMs ?? 30_000));
    this.staleCacheTtlMs = Math.max(
      this.cacheTtlMs,
      Math.floor(options.staleCacheTtlMs ?? 5 * 60_000),
    );
    this.maxCacheEntries = Math.max(1, Math.floor(options.maxCacheEntries ?? 512));
    this.maxFetchAttempts = Math.max(1, Math.floor(options.maxFetchAttempts ?? 3));
    this.initialBackoffMs = Math.max(0, Math.floor(options.initialBackoffMs ?? 200));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? sleep;
  }

  private getCachedEntryState(referenceKey: string):
    | { state: "fresh" | "stale"; issue: IssueContextRecord | null }
    | null {
    const cached = this.issueCache.get(referenceKey);

    if (!cached) {
      return null;
    }

    const ageMs = this.now() - cached.cachedAtMs;

    if (ageMs <= this.cacheTtlMs) {
      return {
        state: "fresh",
        issue: cached.issue,
      };
    }

    if (ageMs <= this.staleCacheTtlMs) {
      return {
        state: "stale",
        issue: cached.issue,
      };
    }

    this.issueCache.delete(referenceKey);
    return null;
  }

  private cacheIssue(referenceKey: string, issue: IssueContextRecord | null) {
    if (this.issueCache.has(referenceKey)) {
      this.issueCache.delete(referenceKey);
    }

    this.issueCache.set(referenceKey, {
      issue,
      cachedAtMs: this.now(),
    });

    while (this.issueCache.size > this.maxCacheEntries) {
      const oldestKey = this.issueCache.keys().next().value;

      if (!oldestKey) {
        break;
      }

      this.issueCache.delete(oldestKey);
    }
  }

  private async fetchIssueWithResilience(input: {
    reference: GitHubIssueReference;
    accessToken: string | null;
  }): Promise<{
    issue: IssueContextRecord | null;
    cacheHit: boolean;
    fallbackReason: "stale_cache" | null;
  }> {
    const referenceKey = toIssueCacheKey({
      reference: input.reference,
      accessToken: input.accessToken,
    });
    const cachedState = this.getCachedEntryState(referenceKey);

    if (cachedState?.state === "fresh") {
      return {
        issue: cachedState.issue,
        cacheHit: true,
        fallbackReason: null,
      };
    }

    let lastError: unknown;
    let lastFailureClassification: IntegrationFailureClassification | null = null;

    for (let attempt = 1; attempt <= this.maxFetchAttempts; attempt += 1) {
      try {
        const fetchedIssue = await this.issueContextProvider.fetchIssue({
          reference: {
            provider: "github",
            owner: input.reference.owner,
            repository: input.reference.repository,
            issueNumber: input.reference.issueNumber,
          },
          accessToken: input.accessToken,
        });

        this.cacheIssue(referenceKey, fetchedIssue);

        return {
          issue: fetchedIssue,
          cacheHit: false,
          fallbackReason: null,
        };
      } catch (error) {
        lastError = error;
        lastFailureClassification = classifyIntegrationFailure(error);

        if (attempt >= this.maxFetchAttempts || !lastFailureClassification.retryable) {
          break;
        }

        const delayMs = this.initialBackoffMs * (2 ** (attempt - 1));

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      }
    }

    const canFallbackToStaleCache =
      cachedState?.state === "stale" &&
      (lastFailureClassification === null || lastFailureClassification.retryable);

    if (canFallbackToStaleCache) {
      return {
        issue: cachedState.issue,
        cacheHit: true,
        fallbackReason: "stale_cache",
      };
    }

    throw lastError;
  }

  async loadSnapshotForReview(input: {
    reviewerId: string;
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    githubIssueAccessToken: string | null;
    githubIssueGrantedScopes: string[];
    source: {
      provider: "github";
      owner: string;
      repository: string;
      pullRequestNumber: number;
    } | {
      provider: "seed_fixture";
      fixtureId: string;
    } | null;
  }): Promise<BusinessContextSnapshot> {
    const fallbackSnapshot = await this.fallbackProvider.loadSnapshotForReview(input);

    if (input.source?.provider !== "github") {
      return fallbackSnapshot;
    }

    const { indexedReferences, uniqueReferences } = collectIssueReferences(fallbackSnapshot.items);

    if (indexedReferences.length === 0 || uniqueReferences.length === 0) {
      return fallbackSnapshot;
    }

    try {
      const fetchedIssueResults = await Promise.all(
        uniqueReferences.map((reference) =>
          this.fetchIssueWithResilience({
            reference,
            accessToken: input.githubIssueAccessToken,
          }),
        ),
      );
      const cacheHit = fetchedIssueResults.some((result) => result.cacheHit);
      const fallbackReason = fetchedIssueResults.some(
        (result) => result.fallbackReason === "stale_cache",
      )
        ? "stale_cache"
        : null;
      const issueByReferenceKey = new Map<string, IssueContextRecord>();

      fetchedIssueResults.forEach((result, index) => {
        const issue = result.issue;

        if (!issue) {
          return;
        }

        issueByReferenceKey.set(
          toIssueReferenceKey(uniqueReferences[index]),
          issue,
        );
      });

      let enrichedCount = 0;
      const referencesByItemIndex = new Map<number, IndexedGitHubIssueReference>();

      for (const reference of indexedReferences) {
        if (!referencesByItemIndex.has(reference.itemIndex)) {
          referencesByItemIndex.set(reference.itemIndex, reference);
        }
      }
      const liveIssueUpdatedAtByItemIndex = new Map<number, string | null>();

      const enrichedItems = fallbackSnapshot.items.map((item, itemIndex) => {
        const reference = referencesByItemIndex.get(itemIndex);

        if (!reference) {
          return item;
        }

        const issue = issueByReferenceKey.get(toIssueReferenceKey(reference));

        if (!issue) {
          return item;
        }

        enrichedCount += 1;
        liveIssueUpdatedAtByItemIndex.set(itemIndex, issue.updatedAt);
        return mergeLiveIssueIntoItem(item, issue);
      });
      const arbitrationCandidates: BusinessContextArbitrationCandidate[] = enrichedItems.map(
        (item, itemIndex) => ({
          candidateId: item.contextId,
          dedupeKey: toContextDedupeKey(item),
          provider: resolveCandidateProvider({
            item,
            isLiveEnriched: liveIssueUpdatedAtByItemIndex.has(itemIndex),
          }),
          confidence: item.confidence,
          status: item.status,
          updatedAt: liveIssueUpdatedAtByItemIndex.get(itemIndex) ?? null,
          item,
        }),
      );
      const arbitrationResult = arbitrateBusinessContextCandidates(arbitrationCandidates);
      const conflictReasonCodes = mergeConflictReasonCodes({
        fallbackConflictReasonCodes: fallbackSnapshot.diagnostics.conflictReasonCodes,
        arbitrationConflictReasonCodes: arbitrationResult.conflictReasonCodes,
      });

      if (enrichedCount === 0) {
        return {
          ...fallbackSnapshot,
          diagnostics: {
            cacheHit,
            fallbackReason,
            conflictReasonCodes,
          },
          items: arbitrationResult.items,
        };
      }

      return {
        generatedAt: new Date().toISOString(),
        provider: "github_live",
        diagnostics: {
          cacheHit,
          fallbackReason,
          conflictReasonCodes,
        },
        items: arbitrationResult.items,
      };
    } catch (error) {
      const failureClassification = classifyIntegrationFailure(error);

      throw new LiveBusinessContextUnavailableError({
        fallbackSnapshot,
        cacheHit: false,
        fallbackReason: "live_fetch_failed",
        retryable: failureClassification.retryable,
        reasonCode: failureClassification.reasonCode,
        message:
          error instanceof Error && error.message.trim().length > 0
            ? `Live business-context fetch failed: ${error.message}`
            : "Live business-context fetch failed.",
        cause: error,
      });
    }
  }
}
