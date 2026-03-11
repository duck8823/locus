import { createHash } from "node:crypto";
import type {
  BusinessContextProvider,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";

interface ExtractedIssueReference {
  owner: string;
  repository: string;
  issueNumber: number;
  status: "linked" | "candidate";
  source:
    | "issue_url"
    | "repo_shorthand"
    | "same_repo_shorthand"
    | "same_repo_closing_keyword"
    | "branch_pattern"
    | "pull_request_fallback";
}

const ISSUE_URL_PATTERN = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)/gi;
const REPO_SHORTHAND_PATTERN = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g;
const SAME_REPO_SHORTHAND_PATTERN = /(?:^|[^A-Za-z0-9_\/])#(\d+)\b/g;
const CLOSING_KEYWORD_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
const BRANCH_ISSUE_PATTERN =
  /\b(?:feature|feat|bugfix|fix|hotfix|issue|issues|task|chore)[/_-]+(?:[a-z]+[_-]+)?(\d{1,7})\b/gi;

function toIssueKey(reference: {
  owner: string;
  repository: string;
  issueNumber: number;
}): string {
  return `${reference.owner.toLowerCase()}/${reference.repository.toLowerCase()}#${reference.issueNumber}`;
}

function upsertIssueReference(
  issueMap: Map<string, ExtractedIssueReference>,
  nextReference: ExtractedIssueReference,
) {
  const issueKey = toIssueKey(nextReference);
  const previous = issueMap.get(issueKey);

  if (!previous) {
    issueMap.set(issueKey, nextReference);
    return;
  }

  if (previous.status === "candidate" && nextReference.status === "linked") {
    issueMap.set(issueKey, nextReference);
  }
}

function extractHeadBranchLabel(branchLabel: string): string {
  const normalized = branchLabel.trim();

  if (normalized.length === 0) {
    return "";
  }

  const arrowSeparatorIndex = normalized.indexOf("→");

  if (arrowSeparatorIndex >= 0) {
    return normalized.slice(0, arrowSeparatorIndex).trim();
  }

  const asciiArrowSeparatorIndex = normalized.indexOf("->");

  if (asciiArrowSeparatorIndex >= 0) {
    return normalized.slice(0, asciiArrowSeparatorIndex).trim();
  }

  return normalized;
}

function parseIssueReferences(input: {
  title: string;
  branchLabel: string;
  owner: string;
  repository: string;
  pullRequestNumber: number;
}): ExtractedIssueReference[] {
  const issueMap = new Map<string, ExtractedIssueReference>();
  const normalizedTitle = input.title.trim();
  const normalizedHeadBranch = extractHeadBranchLabel(input.branchLabel);

  ISSUE_URL_PATTERN.lastIndex = 0;
  REPO_SHORTHAND_PATTERN.lastIndex = 0;
  SAME_REPO_SHORTHAND_PATTERN.lastIndex = 0;
  CLOSING_KEYWORD_PATTERN.lastIndex = 0;
  BRANCH_ISSUE_PATTERN.lastIndex = 0;

  for (const match of normalizedTitle.matchAll(ISSUE_URL_PATTERN)) {
    const owner = match[1];
    const repository = match[2];
    const issueNumber = Number.parseInt(match[3] ?? "", 10);

    if (!owner || !repository || !Number.isInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }

    upsertIssueReference(issueMap, {
      owner,
      repository,
      issueNumber,
      status: "linked",
      source: "issue_url",
    });
  }

  for (const match of normalizedTitle.matchAll(REPO_SHORTHAND_PATTERN)) {
    const owner = match[1];
    const repository = match[2];
    const issueNumber = Number.parseInt(match[3] ?? "", 10);

    if (!owner || !repository || !Number.isInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }

    upsertIssueReference(issueMap, {
      owner,
      repository,
      issueNumber,
      status: "linked",
      source: "repo_shorthand",
    });
  }

  for (const match of normalizedTitle.matchAll(CLOSING_KEYWORD_PATTERN)) {
    const issueNumber = Number.parseInt(match[1] ?? "", 10);

    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }

    upsertIssueReference(issueMap, {
      owner: input.owner,
      repository: input.repository,
      issueNumber,
      status: "linked",
      source: "same_repo_closing_keyword",
    });
  }

  for (const match of normalizedTitle.matchAll(SAME_REPO_SHORTHAND_PATTERN)) {
    const issueNumber = Number.parseInt(match[1] ?? "", 10);

    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }

    upsertIssueReference(issueMap, {
      owner: input.owner,
      repository: input.repository,
      issueNumber,
      status: "candidate",
      source: "same_repo_shorthand",
    });
  }

  for (const match of normalizedHeadBranch.matchAll(BRANCH_ISSUE_PATTERN)) {
    const issueNumber = Number.parseInt(match[1] ?? "", 10);

    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      continue;
    }

    upsertIssueReference(issueMap, {
      owner: input.owner,
      repository: input.repository,
      issueNumber,
      status: "candidate",
      source: "branch_pattern",
    });
  }

  if (issueMap.size === 0) {
    upsertIssueReference(issueMap, {
      owner: input.owner,
      repository: input.repository,
      issueNumber: input.pullRequestNumber,
      status: "candidate",
      source: "pull_request_fallback",
    });
  }

  return [...issueMap.values()].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "linked" ? -1 : 1;
    }

    return toIssueKey(left).localeCompare(toIssueKey(right));
  });
}

function toIssueSummary(reference: ExtractedIssueReference): string {
  if (reference.source === "issue_url") {
    return "Detected from an explicit GitHub issue URL in the PR title.";
  }

  if (reference.source === "repo_shorthand") {
    return "Detected from owner/repository#issue shorthand in the PR title.";
  }

  if (reference.source === "same_repo_shorthand") {
    return "Detected from #issue shorthand in the PR title (same repository inferred).";
  }

  if (reference.source === "same_repo_closing_keyword") {
    return "Detected from close/fix/resolve keyword in the PR title.";
  }

  if (reference.source === "branch_pattern") {
    return "Detected from branch naming convention (issue number in head branch).";
  }

  return "No explicit issue reference found in title. Showing a deterministic fallback candidate.";
}

function createIssueTitle(reference: ExtractedIssueReference): string {
  const prefix = reference.status === "linked" ? "Linked issue" : "Candidate issue";
  return `${prefix}: ${reference.owner}/${reference.repository}#${reference.issueNumber}`;
}

function createIssueHref(reference: ExtractedIssueReference): string {
  return `https://github.com/${reference.owner}/${reference.repository}/issues/${reference.issueNumber}`;
}

function toIssueConfidence(reference: ExtractedIssueReference): "high" | "medium" | "low" {
  if (
    reference.source === "issue_url" ||
    reference.source === "repo_shorthand" ||
    reference.source === "same_repo_closing_keyword"
  ) {
    return "high";
  }

  if (reference.source === "same_repo_shorthand" || reference.source === "branch_pattern") {
    return "medium";
  }

  return "low";
}

export class StubBusinessContextProvider implements BusinessContextProvider {
  async loadSnapshotForReview(input: {
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
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
    const generatedAt = new Date().toISOString();
    const sharedSuffix = createHash("sha256")
      .update(`${input.reviewId}\u0000${input.repositoryName}\u0000${input.title}`)
      .digest("hex")
      .slice(0, 10);
    const items: BusinessContextSnapshot["items"] = [];

    if (input.source?.provider === "github") {
      const issueReferences = parseIssueReferences({
        title: input.title,
        branchLabel: input.branchLabel,
        owner: input.source.owner,
        repository: input.source.repository,
        pullRequestNumber: input.source.pullRequestNumber,
      });

      for (const issueReference of issueReferences) {
        const issueHash = createHash("sha256")
          .update(
            `${input.reviewId}\u0000${issueReference.owner}\u0000${issueReference.repository}\u0000${issueReference.issueNumber}`,
          )
          .digest("hex")
          .slice(0, 10);

        items.push({
          contextId: `ctx-gh-issue-${issueHash}`,
          sourceType: "github_issue",
          status: issueReference.status,
          confidence: toIssueConfidence(issueReference),
          inferenceSource: issueReference.source,
          title: createIssueTitle(issueReference),
          summary: toIssueSummary(issueReference),
          href: createIssueHref(issueReference),
        });
      }
    } else {
      items.push({
        contextId: `ctx-gh-issue-${sharedSuffix}`,
        sourceType: "github_issue",
        status: "unavailable",
        confidence: "low",
        inferenceSource: "none",
        title: "No GitHub issue context is linked yet",
        summary: "Issue context requires a GitHub-hosted review source.",
        href: null,
      });
    }

    items.push({
      contextId: `ctx-confluence-${sharedSuffix}`,
      sourceType: "confluence_page",
      status: "unavailable",
      confidence: "low",
      inferenceSource: "none",
      title: "No Confluence page linked",
      summary:
        "Confluence linking is intentionally deferred; this panel defines the future contract.",
      href: null,
    });

    return {
      generatedAt,
      provider: "stub",
      items,
    };
  }
}
