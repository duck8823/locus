import { assertReviewGroupStatus, type ReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export interface ProgressRequest {
  groupId: string;
  status: ReviewGroupStatus;
}

export function parseProgressRequest(body: unknown): ProgressRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Progress request body must be an object.");
  }

  const groupId = readString(body, "groupId");
  const status = assertReviewGroupStatus(readString(body, "status"));

  return {
    groupId,
    status,
  };
}

function readString(body: object, key: string): string {
  const value = Reflect.get(body, key);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return value;
}
