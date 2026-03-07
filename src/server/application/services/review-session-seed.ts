import { ReviewSession, type ReviewGroupRecord } from "@/server/domain/entities/review-session";

export interface CreateSeedReviewSessionInput {
  reviewId: string;
  viewerName: string;
  createdAt: string;
}

function createSeedGroups(): ReviewGroupRecord[] {
  return [
    {
      groupId: "workspace-route",
      title: "Review workspace route",
      summary: "Initial App Router page that renders the review workspace shell.",
      filePath: "src/app/(workspace)/reviews/[reviewId]/page.tsx",
      status: "in_progress",
      upstream: ["route:workspace-review-page", "state:viewer-cookie"],
      downstream: ["usecase:open-review-workspace", "dto:review-workspace"],
    },
    {
      groupId: "review-session-domain",
      title: "Review session aggregate",
      summary: "Domain state that tracks selection, progress, and reopenable review metadata.",
      filePath: "src/server/domain/entities/review-session.ts",
      status: "unread",
      upstream: ["usecase:open-review-workspace", "usecase:mark-review-group-status"],
      downstream: ["repository:review-session", "dto:review-workspace"],
    },
    {
      groupId: "file-repository",
      title: "File-backed review session repository",
      summary: "Temporary persistence boundary used to reopen the first workspace without losing state.",
      filePath: "src/server/infrastructure/db/file-review-session-repository.ts",
      status: "unread",
      upstream: ["port:review-session-repository", "composition:dependencies"],
      downstream: ["storage:.locus-data/review-sessions", "usecase:open-review-workspace"],
    },
  ];
}

export function createSeedReviewSession({
  reviewId,
  viewerName,
  createdAt,
}: CreateSeedReviewSessionInput): ReviewSession {
  return ReviewSession.create({
    reviewId,
    title: "Demo review workspace",
    repositoryName: "duck8823/locus",
    branchLabel: "feat/web-shell-skeleton",
    viewerName,
    groups: createSeedGroups(),
    selectedGroupId: "workspace-route",
    lastOpenedAt: createdAt,
    lastReanalyzeRequestedAt: null,
  });
}
