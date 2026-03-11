import { createHash } from "node:crypto";
import type {
  BusinessContextProvider,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";

export class StubBusinessContextProvider implements BusinessContextProvider {
  async loadSnapshotForReview(input: {
    reviewId: string;
    repositoryName: string;
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
      items.push({
        contextId: `ctx-gh-issue-${sharedSuffix}`,
        sourceType: "github_issue",
        status: "candidate",
        title: `Candidate requirement thread for PR #${input.source.pullRequestNumber}`,
        summary:
          "This is a stub bridge. Replace with real linked issue/project context in phase 2.",
        href: `https://github.com/${input.source.owner}/${input.source.repository}/issues/${input.source.pullRequestNumber}`,
      });
    } else {
      items.push({
        contextId: `ctx-gh-issue-${sharedSuffix}`,
        sourceType: "github_issue",
        status: "unavailable",
        title: "No GitHub issue context is linked yet",
        summary: "Issue context requires a GitHub-hosted review source.",
        href: null,
      });
    }

    items.push({
      contextId: `ctx-confluence-${sharedSuffix}`,
      sourceType: "confluence_page",
      status: "unavailable",
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
