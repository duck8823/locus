export const ANONYMOUS_REVIEWER_ID = "anonymous";

export function resolveReviewerId(viewerCookie: string | undefined): string {
  const normalized = viewerCookie?.trim();

  if (!normalized) {
    return ANONYMOUS_REVIEWER_ID;
  }

  return normalized;
}
