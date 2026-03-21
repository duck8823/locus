import { auth } from "auth";

export const ANONYMOUS_REVIEWER_ID = "anonymous";

/**
 * Resolve reviewer ID from demo cookie (legacy/demo mode).
 */
export function resolveReviewerId(viewerCookie: string | undefined): string {
  const normalized = viewerCookie?.trim();

  if (!normalized) {
    return ANONYMOUS_REVIEWER_ID;
  }

  return normalized;
}

/**
 * Resolve reviewer ID from Auth.js session, falling back to demo cookie.
 * Authenticated users get a stable `user:<id>` reviewer ID.
 */
export async function resolveAuthenticatedReviewerId(
  viewerCookie: string | undefined,
): Promise<{ reviewerId: string; userId: string | null }> {
  const session = await auth();

  if (session?.user?.id) {
    return {
      reviewerId: `user:${session.user.id}`,
      userId: session.user.id,
    };
  }

  return {
    reviewerId: resolveReviewerId(viewerCookie),
    userId: null,
  };
}
