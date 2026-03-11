import { describe, expect, it } from "vitest";
import {
  assertConnectionStatusTransition,
  assertWritableConnectionStatus,
  listAllowedConnectionTransitions,
} from "@/server/domain/value-objects/connection-lifecycle-status";

describe("connection-lifecycle-status", () => {
  it("returns writable status when supported", () => {
    expect(assertWritableConnectionStatus("connected")).toBe("connected");
    expect(assertWritableConnectionStatus("reauth_required")).toBe("reauth_required");
    expect(assertWritableConnectionStatus("not_connected")).toBe("not_connected");
  });

  it("rejects non-writable statuses", () => {
    expect(() => assertWritableConnectionStatus("planned")).toThrow(
      "Unsupported writable connection status: planned",
    );
  });

  it("lists allowed transitions from known statuses", () => {
    expect(listAllowedConnectionTransitions("not_connected")).toEqual(["connected"]);
    expect(listAllowedConnectionTransitions("connected")).toEqual([
      "not_connected",
      "reauth_required",
    ]);
    expect(listAllowedConnectionTransitions("planned")).toEqual([]);
  });

  it("returns empty allowed transitions for unknown status", () => {
    expect(listAllowedConnectionTransitions("temporarily_locked")).toEqual([]);
  });

  it("accepts idempotent transition and valid transitions", () => {
    expect(() => assertConnectionStatusTransition("connected", "connected")).not.toThrow();
    expect(() => assertConnectionStatusTransition("connected", "reauth_required")).not.toThrow();
  });

  it("rejects unsupported or invalid transitions", () => {
    expect(() => assertConnectionStatusTransition("temporarily_locked", "connected")).toThrow(
      "Unsupported current connection status: temporarily_locked",
    );
    expect(() => assertConnectionStatusTransition("planned", "connected")).toThrow(
      "Invalid connection status transition: planned -> connected",
    );
  });
});
