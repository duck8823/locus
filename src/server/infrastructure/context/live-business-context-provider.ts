import type {
  BusinessContextItem,
  BusinessContextProvider,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";
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

export interface LiveBusinessContextProviderOptions {
  issueContextProvider: IssueContextProvider;
  fallbackProvider?: BusinessContextProvider;
}

export class LiveBusinessContextProvider implements BusinessContextProvider {
  private readonly issueContextProvider: IssueContextProvider;
  private readonly fallbackProvider: BusinessContextProvider;

  constructor(options: LiveBusinessContextProviderOptions) {
    this.issueContextProvider = options.issueContextProvider;
    this.fallbackProvider = options.fallbackProvider ?? new StubBusinessContextProvider();
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
      const fetchedIssues = await Promise.all(
        uniqueReferences.map((reference) =>
          this.issueContextProvider.fetchIssue({
            reference: {
              provider: "github",
              owner: reference.owner,
              repository: reference.repository,
              issueNumber: reference.issueNumber,
            },
            accessToken: input.githubIssueAccessToken,
          }),
        ),
      );
      const issueByReferenceKey = new Map<string, IssueContextRecord>();

      fetchedIssues.forEach((issue, index) => {
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
        return mergeLiveIssueIntoItem(item, issue);
      });

      if (enrichedCount === 0) {
        return fallbackSnapshot;
      }

      return {
        generatedAt: new Date().toISOString(),
        provider: "github_live",
        items: enrichedItems,
      };
    } catch {
      return fallbackSnapshot;
    }
  }
}
