import { assertReviewGroupStatus, type ReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export interface ProgressRequest {
  groupId: string;
  status: ReviewGroupStatus;
}

export function parseProgressRequest(body: unknown): ProgressRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Progress request body must be an object.");
  }

  const groupId = readString(body, "groupId", { maxLength: 256 });
  const status = assertReviewGroupStatus(readString(body, "status", { maxLength: 32 }));

  return {
    groupId,
    status,
  };
}

function readString(
  body: object,
  key: string,
  options: {
    maxLength?: number;
  } = {},
): string {
  const value = Reflect.get(body, key);
  const normalizedValue = typeof value === "string" ? value.trim() : value;
  const maxLength = options.maxLength ?? 256;

  if (typeof normalizedValue !== "string" || normalizedValue.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  if (normalizedValue.length > maxLength) {
    throw new Error(`${key} must be at most ${maxLength} characters.`);
  }

  return normalizedValue;
}
