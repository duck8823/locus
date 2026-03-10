export interface ReanalyzeRequest {
  requestedBy: string | null;
}

const MAX_REQUESTED_BY_LENGTH = 120;

export function parseReanalyzeRequest(body: unknown): ReanalyzeRequest {
  if (body == null) {
    return { requestedBy: null };
  }

  if (typeof body !== "object") {
    throw new Error("Reanalyze request body must be an object or null.");
  }

  const requestedBy = Reflect.get(body, "requestedBy");

  if (requestedBy == null) {
    return { requestedBy: null };
  }

  if (typeof requestedBy !== "string") {
    throw new Error("requestedBy must be a string when provided.");
  }

  const normalizedRequestedBy = requestedBy.trim();

  if (normalizedRequestedBy.length === 0) {
    return { requestedBy: null };
  }

  if (normalizedRequestedBy.length > MAX_REQUESTED_BY_LENGTH) {
    throw new Error(
      `requestedBy must be at most ${MAX_REQUESTED_BY_LENGTH} characters when provided.`,
    );
  }

  return { requestedBy: normalizedRequestedBy };
}
