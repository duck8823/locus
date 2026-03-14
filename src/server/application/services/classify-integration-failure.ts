export type IntegrationFailureReasonCode =
  | "timeout"
  | "network"
  | "rate_limit"
  | "auth"
  | "not_found"
  | "upstream_5xx"
  | "client_error"
  | "unknown";

export type IntegrationFailureClass = "transient" | "terminal";

export interface IntegrationFailureClassification {
  retryable: boolean;
  failureClass: IntegrationFailureClass;
  reasonCode: IntegrationFailureReasonCode;
  statusCode: number | null;
}

function toClassification(input: {
  retryable: boolean;
  failureClass: IntegrationFailureClass;
  reasonCode: IntegrationFailureReasonCode;
  statusCode: number | null;
}): IntegrationFailureClassification {
  return {
    retryable: input.retryable,
    failureClass: input.failureClass,
    reasonCode: input.reasonCode,
    statusCode: input.statusCode,
  };
}

function classifyByStatusCode(statusCode: number): IntegrationFailureClassification | null {
  if (!Number.isInteger(statusCode)) {
    return null;
  }

  if (statusCode === 401 || statusCode === 403) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "auth",
      statusCode,
    });
  }

  if (statusCode === 404) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "not_found",
      statusCode,
    });
  }

  if (statusCode === 408) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "timeout",
      statusCode,
    });
  }

  if (statusCode === 429) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "rate_limit",
      statusCode,
    });
  }

  if (statusCode >= 500 && statusCode < 600) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "upstream_5xx",
      statusCode,
    });
  }

  if (statusCode >= 400 && statusCode < 500) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "client_error",
      statusCode,
    });
  }

  return null;
}

function parseStatusCodeFromMessage(message: string): number | null {
  const fromStatusPattern = /\bstatus(?:\s*code)?\s*[:=]?\s*(\d{3})\b/i.exec(message);

  if (fromStatusPattern) {
    return Number(fromStatusPattern[1]);
  }

  const fromParenthesis = /\((\d{3})\)/.exec(message);

  if (fromParenthesis) {
    return Number(fromParenthesis[1]);
  }

  return null;
}

function classifyBySystemCode(code: string): IntegrationFailureClassification | null {
  const normalizedCode = code.trim().toUpperCase();
  const timeoutCodes = new Set([
    "ETIMEDOUT",
    "ESOCKETTIMEDOUT",
    "ERR_SOCKET_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "ABORT_ERR",
  ]);

  if (timeoutCodes.has(normalizedCode)) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "timeout",
      statusCode: null,
    });
  }

  const networkCodes = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "EAI_AGAIN",
    "ENETDOWN",
    "ENETRESET",
    "ENETUNREACH",
    "ENOTFOUND",
  ]);

  if (networkCodes.has(normalizedCode)) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "network",
      statusCode: null,
    });
  }

  return null;
}

function classifyByMessage(message: string): IntegrationFailureClassification | null {
  const normalized = message.toLowerCase();
  const statusCodeFromMessage = parseStatusCodeFromMessage(message);

  if (statusCodeFromMessage !== null) {
    const statusBased = classifyByStatusCode(statusCodeFromMessage);

    if (statusBased) {
      return statusBased;
    }
  }

  if (
    /rate limit|too many requests/.test(normalized) ||
    /\b429\b/.test(normalized)
  ) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "rate_limit",
      statusCode: statusCodeFromMessage,
    });
  }

  if (
    /timeout|timed out|deadline exceeded|operation timed out/.test(normalized) ||
    /\babort(?:ed|error)?\b/.test(normalized)
  ) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "timeout",
      statusCode: statusCodeFromMessage,
    });
  }

  if (
    /unauthori[sz]ed|forbidden|insufficient scope|missing [\w-]+\s*scope|issue-read scope|bad credentials|token expired|authentication failed/.test(
      normalized,
    ) ||
    /\b(401|403)\b/.test(normalized)
  ) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "auth",
      statusCode: statusCodeFromMessage,
    });
  }

  if (/not found/.test(normalized) || /\b404\b/.test(normalized)) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "not_found",
      statusCode: statusCodeFromMessage,
    });
  }

  if (
    /econn|enet|ehost|enotfound|eai_again|fetch failed|network error|socket hang up|connection reset/.test(
      normalized,
    )
  ) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "network",
      statusCode: statusCodeFromMessage,
    });
  }

  if (/\b5\d\d\b/.test(normalized)) {
    return toClassification({
      retryable: true,
      failureClass: "transient",
      reasonCode: "upstream_5xx",
      statusCode: statusCodeFromMessage,
    });
  }

  if (/\b4\d\d\b/.test(normalized)) {
    return toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "client_error",
      statusCode: statusCodeFromMessage,
    });
  }

  return null;
}

export function classifyIntegrationFailure(error: unknown): IntegrationFailureClassification {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();
  let messageCandidate: IntegrationFailureClassification | null = null;

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === null || current === undefined || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (current instanceof Error) {
      if (current.name === "AbortError") {
        return toClassification({
          retryable: true,
          failureClass: "transient",
          reasonCode: "timeout",
          statusCode: null,
        });
      }

      const messageClassification = classifyByMessage(current.message);

      if (messageClassification && !messageCandidate) {
        messageCandidate = messageClassification;
      }
    }

    if (typeof current === "string") {
      const messageClassification = classifyByMessage(current);

      if (messageClassification && !messageCandidate) {
        messageCandidate = messageClassification;
      }

      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const statusLike =
      (current as { status?: unknown }).status ??
      (current as { statusCode?: unknown }).statusCode ??
      (current as { response?: { status?: unknown } }).response?.status ??
      (current as { response?: { statusCode?: unknown } }).response?.statusCode;
    const statusCode = typeof statusLike === "number" ? statusLike : null;

    if (statusCode !== null) {
      const statusClassification = classifyByStatusCode(statusCode);

      if (statusClassification) {
        return statusClassification;
      }
    }

    const code = (current as { code?: unknown }).code;

    if (typeof code === "string") {
      const codeClassification = classifyBySystemCode(code);

      if (codeClassification) {
        return codeClassification;
      }
    }

    const messageValue = (current as { message?: unknown }).message;

    if (typeof messageValue === "string") {
      const messageClassification = classifyByMessage(messageValue);

      if (messageClassification && !messageCandidate) {
        messageCandidate = messageClassification;
      }
    }

    const cause = (current as { cause?: unknown }).cause;
    const response = (current as { response?: unknown }).response;
    const errorField = (current as { error?: unknown }).error;

    if (cause !== undefined) {
      queue.push(cause);
    }

    if (response !== undefined) {
      queue.push(response);
    }

    if (errorField !== undefined) {
      queue.push(errorField);
    }
  }

  return (
    messageCandidate ??
    toClassification({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "unknown",
      statusCode: null,
    })
  );
}

export function isRetryableIntegrationFailure(error: unknown): boolean {
  return classifyIntegrationFailure(error).retryable;
}
