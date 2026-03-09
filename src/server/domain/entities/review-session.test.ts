import { describe, expect, it } from "vitest";
import { ReviewSession } from "@/server/domain/entities/review-session";
import { ReviewGroupNotFoundError } from "@/server/domain/errors/review-group-not-found-error";

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

  it("tracks running/succeeded/failed reanalysis metadata", () => {
    const session = createSession();

    session.requestReanalysis("2026-03-08T00:00:00.000Z");
    expect(session.toRecord().reanalysisStatus).toBe("running");
    expect(session.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-08T00:00:00.000Z");

    session.markReanalysisSucceeded("2026-03-08T00:00:10.000Z");
    expect(session.toRecord().reanalysisStatus).toBe("succeeded");
    expect(session.toRecord().lastReanalyzeCompletedAt).toBe("2026-03-08T00:00:10.000Z");
    expect(session.toRecord().lastReanalyzeError).toBeNull();

    session.markReanalysisFailed(
      "2026-03-08T00:00:20.000Z",
      "GitHub API request failed",
      "2026-03-08T00:00:15.000Z",
    );
    expect(session.toRecord().reanalysisStatus).toBe("failed");
    expect(session.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-08T00:00:15.000Z");
    expect(session.toRecord().lastReanalyzeCompletedAt).toBe("2026-03-08T00:00:20.000Z");
    expect(session.toRecord().lastReanalyzeError).toBe("GitHub API request failed");
  });

  it("tracks queued/fetching/parsing/ready/failed analysis metadata", () => {
    const session = createSession();

    session.markAnalysisQueued("2026-03-08T00:00:00.000Z");
    expect(session.toRecord().analysisStatus).toBe("queued");
    expect(session.toRecord().analysisRequestedAt).toBe("2026-03-08T00:00:00.000Z");
    expect(session.toRecord().analysisProcessedFiles).toBe(0);

    session.markAnalysisFetching();
    expect(session.toRecord().analysisStatus).toBe("fetching");

    session.markAnalysisParsing(8);
    expect(session.toRecord().analysisStatus).toBe("parsing");
    expect(session.toRecord().analysisTotalFiles).toBe(8);
    expect(session.toRecord().analysisProcessedFiles).toBe(0);

    session.updateAnalysisProgress(3, 8);
    expect(session.toRecord().analysisProcessedFiles).toBe(3);

    session.markAnalysisReady("2026-03-08T00:01:00.000Z", 8);
    expect(session.toRecord().analysisStatus).toBe("ready");
    expect(session.toRecord().analysisCompletedAt).toBe("2026-03-08T00:01:00.000Z");
    expect(session.toRecord().analysisProcessedFiles).toBe(8);
    expect(session.toRecord().analysisError).toBeNull();

    session.markAnalysisFailed("2026-03-08T00:02:00.000Z", "GitHub API request failed");
    expect(session.toRecord().analysisStatus).toBe("failed");
    expect(session.toRecord().analysisCompletedAt).toBe("2026-03-08T00:02:00.000Z");
    expect(session.toRecord().analysisError).toBe("GitHub API request failed");
  });

  it("normalizes legacy reanalysis fields", () => {
    const legacyRecord = {
      ...createSession().toRecord(),
      lastReanalyzeRequestedAt: "2026-03-08T00:00:00.000Z",
      reanalysisStatus: undefined,
      lastReanalyzeCompletedAt: undefined,
      lastReanalyzeError: undefined,
    };
    const session = ReviewSession.fromRecord(legacyRecord);

    expect(session.toRecord().analysisStatus).toBe("ready");
    expect(session.toRecord().reanalysisStatus).toBe("succeeded");
    expect(session.toRecord().lastReanalyzeCompletedAt).toBeNull();
    expect(session.toRecord().lastReanalyzeError).toBeNull();
  });

  it("clones source metadata defensively", () => {
    const session = ReviewSession.create({
      ...createSession().toRecord(),
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 12,
      },
    });

    const record = session.toRecord();
    if (!record.source || record.source.provider !== "github") {
      throw new Error("unexpected source");
    }

    record.source.owner = "tampered-owner";

    const reloadedRecord = session.toRecord();
    expect(reloadedRecord.source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
  });
});
