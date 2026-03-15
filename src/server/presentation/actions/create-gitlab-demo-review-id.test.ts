import { describe, expect, it } from "vitest";
import { createGitLabDemoReviewId } from "./create-gitlab-demo-review-id";

describe("createGitLabDemoReviewId", () => {
  it("keeps hash stable for equivalent canonical project paths", () => {
    expect(createGitLabDemoReviewId("Group/Project", 12)).toBe(
      createGitLabDemoReviewId(" group/project ", 12),
    );
  });

  it("bounds the human-readable project segment to avoid oversized file names", () => {
    const longProjectPath = Array.from({ length: 30 }, (_, index) => `group-${index}`).join("/");
    const reviewId = createGitLabDemoReviewId(longProjectPath, 123);
    const match = /^gitlab-(.+)-mr-123-[a-f0-9]{10}$/.exec(reviewId);

    expect(match).not.toBeNull();
    expect(match?.[1]?.length ?? 0).toBeLessThanOrEqual(72);
  });

  it("falls back to a safe project segment when normalization becomes empty", () => {
    const reviewId = createGitLabDemoReviewId("////", 1);

    expect(reviewId).toMatch(/^gitlab-project-mr-1-[a-f0-9]{10}$/);
  });
});
