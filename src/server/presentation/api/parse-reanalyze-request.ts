export interface ReanalyzeRequest {
  requestedBy: string | null;
}

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

  return { requestedBy };
}
