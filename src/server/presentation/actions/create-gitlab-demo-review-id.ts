import { createHash } from "node:crypto";

const MAX_REVIEW_ID_PROJECT_SEGMENT_LENGTH = 72;

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function truncateSegment(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).replaceAll(/-+$/g, "");
}

export function createGitLabDemoReviewId(projectPath: string, mergeRequestIid: number): string {
  const normalizedProjectPath = truncateSegment(
    normalizeSegment(projectPath),
    MAX_REVIEW_ID_PROJECT_SEGMENT_LENGTH,
  );
  const boundedProjectPath = normalizedProjectPath || "project";
  const canonicalProjectPath = projectPath.trim().toLowerCase();
  const discriminator = createHash("sha256")
    .update(`${canonicalProjectPath}\u0000${mergeRequestIid}`)
    .digest("hex")
    .slice(0, 10);

  return `gitlab-${boundedProjectPath}-mr-${mergeRequestIid}-${discriminator}`;
}
