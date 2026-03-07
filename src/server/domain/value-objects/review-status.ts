export const reviewGroupStatuses = [
  "unread",
  "in_progress",
  "reviewed",
] as const;

export type ReviewGroupStatus = (typeof reviewGroupStatuses)[number];

export function isReviewGroupStatus(value: string): value is ReviewGroupStatus {
  return (reviewGroupStatuses as readonly string[]).includes(value);
}

export function assertReviewGroupStatus(value: string): ReviewGroupStatus {
  if (!isReviewGroupStatus(value)) {
    throw new Error(`Invalid review group status: ${value}`);
  }

  return value;
}
