import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";

export interface BusinessContextItem {
  contextId: string;
  sourceType: "github_issue" | "confluence_page";
  status: "linked" | "candidate" | "unavailable";
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
    reviewId: string;
    repositoryName: string;
    title: string;
    source: ReviewSessionSource | null;
  }): Promise<BusinessContextSnapshot>;
}
