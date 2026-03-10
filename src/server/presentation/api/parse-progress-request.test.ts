import { describe, expect, it } from "vitest";
import { parseProgressRequest } from "@/server/presentation/api/parse-progress-request";

describe("parseProgressRequest", () => {
  it("parses group status payload and trims surrounding whitespace", () => {
    const result = parseProgressRequest({
      groupId: "  group-1  ",
      status: " reviewed ",
    });

    expect(result).toEqual({
      groupId: "group-1",
      status: "reviewed",
    });
  });

  it("rejects non-object payloads", () => {
    expect(() => parseProgressRequest(null)).toThrow(
      "Progress request body must be an object.",
    );
  });

  it("rejects whitespace-only strings", () => {
    expect(() =>
      parseProgressRequest({
        groupId: "   ",
        status: "reviewed",
      }),
    ).toThrow("groupId must be a non-empty string.");
  });

  it("rejects excessively long group ids", () => {
    expect(() =>
      parseProgressRequest({
        groupId: "g".repeat(257),
        status: "reviewed",
      }),
    ).toThrow("groupId must be at most 256 characters.");
  });

  it("rejects unknown statuses", () => {
    expect(() =>
      parseProgressRequest({
        groupId: "group-1",
        status: "done",
      }),
    ).toThrow("Invalid review group status: done");
  });
});
