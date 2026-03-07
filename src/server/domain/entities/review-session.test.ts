import { describe, expect, it } from "vitest";
import { ReviewSession, ReviewGroupNotFoundError } from "@/server/domain/entities/review-session";

function createSession() {
  return ReviewSession.create({
    reviewId: "demo-review",
    title: "Demo",
    repositoryName: "duck8823/locus",
    branchLabel: "feat/web-shell-skeleton",
    viewerName: "Demo reviewer",
    lastOpenedAt: "2026-03-07T00:00:00.000Z",
    groups: [
      {
        groupId: "group-a",
        title: "Group A",
        summary: "A",
        filePath: "a.ts",
        status: "unread",
        upstream: [],
        downstream: [],
      },
      {
        groupId: "group-b",
        title: "Group B",
        summary: "B",
        filePath: "b.ts",
        status: "unread",
        upstream: [],
        downstream: [],
      },
    ],
  });
}

describe("ReviewSession", () => {
  it("updates the selected group", () => {
    const session = createSession();

    session.selectGroup("group-b");

    expect(session.toRecord().selectedGroupId).toBe("group-b");
  });

  it("updates group status", () => {
    const session = createSession();

    session.setGroupStatus("group-a", "reviewed");

    expect(session.toRecord().groups.find((group) => group.groupId === "group-a")?.status).toBe(
      "reviewed",
    );
  });

  it("raises when selecting an unknown group", () => {
    const session = createSession();

    expect(() => session.selectGroup("missing")).toThrow(ReviewGroupNotFoundError);
  });
});
