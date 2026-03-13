import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";

export interface BusinessContextItem {
  contextId: string;
  sourceType: "github_issue" | "confluence_page";
  status: "linked" | "candidate" | "unavailable";
  confidence: "high" | "medium" | "low";
  inferenceSource:
    | "issue_url"
    | "repo_shorthand"
    | "same_repo_shorthand"
    | "same_repo_closing_keyword"
    | "branch_pattern"
    | "pull_request_fallback"
    | "none";
  title: string;
  summary: string | null;
  href: string | null;
}

export interface BusinessContextSnapshot {
  generatedAt: string;
  provider: "stub";
  items: BusinessContextItem[];
}

export interface BusinessContextProvider {
  loadSnapshotForReview(input: {
    reviewerId: string;
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    githubIssueAccessToken: string | null;
    githubIssueGrantedScopes: string[];
    source: ReviewSessionSource | null;
  }): Promise<BusinessContextSnapshot>;
}
