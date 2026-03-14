import { describe, expect, it } from "vitest";
import {
  classifyIntegrationFailure,
  type IntegrationFailureClassification,
} from "@/server/application/services/classify-integration-failure";

function pickComparableFields(input: IntegrationFailureClassification) {
  return {
    retryable: input.retryable,
    failureClass: input.failureClass,
    reasonCode: input.reasonCode,
  };
}

describe("classifyIntegrationFailure", () => {
  it.each([
    {
      name: "timeout failures as transient",
      error: (() => {
        const error = new Error("Request timed out");
        error.name = "AbortError";
        return error;
      })(),
      expected: {
        retryable: true,
        failureClass: "transient",
        reasonCode: "timeout",
      },
    },
    {
      name: "network failures as transient",
      error: new TypeError("fetch failed", {
        cause: {
          code: "ENOTFOUND",
        },
      }),
      expected: {
        retryable: true,
        failureClass: "transient",
        reasonCode: "network",
      },
    },
    {
      name: "rate limit failures as transient",
      error: {
        status: 429,
        message: "Too Many Requests",
      },
      expected: {
        retryable: true,
        failureClass: "transient",
        reasonCode: "rate_limit",
      },
    },
    {
      name: "auth failures as terminal",
      error: {
        statusCode: 401,
        message: "Unauthorized",
      },
      expected: {
        retryable: false,
        failureClass: "terminal",
        reasonCode: "auth",
      },
    },
    {
      name: "not found failures as terminal",
      error: {
        response: {
          status: 404,
        },
      },
      expected: {
        retryable: false,
        failureClass: "terminal",
        reasonCode: "not_found",
      },
    },
  ])("classifies $name", ({ error, expected }) => {
    const result = classifyIntegrationFailure(error);

    expect(pickComparableFields(result)).toEqual(expected);
  });

  it("classifies upstream 5xx from status embedded in message", () => {
    const result = classifyIntegrationFailure(
      new Error("GitHub issue API failed (503): upstream timeout"),
    );

    expect(pickComparableFields(result)).toEqual({
      retryable: true,
      failureClass: "transient",
      reasonCode: "upstream_5xx",
    });
    expect(result.statusCode).toBe(503);
  });

  it("falls back to unknown terminal when no signal can be parsed", () => {
    const result = classifyIntegrationFailure(new Error("unexpected parser crash"));

    expect(pickComparableFields(result)).toEqual({
      retryable: false,
      failureClass: "terminal",
      reasonCode: "unknown",
    });
    expect(result.statusCode).toBeNull();
  });
});
