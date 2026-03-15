import { describe, expect, it } from "vitest";
import { createPluginCapabilityPolicy } from "@/server/infrastructure/plugins/plugin-capability-policy";

describe("createPluginCapabilityPolicy", () => {
  it("allows all capabilities by default", () => {
    const policy = createPluginCapabilityPolicy();

    expect(
      policy.evaluate({
        kind: "pull-request-snapshot-provider",
        provider: "github",
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects capabilities listed in denylist", () => {
    const policy = createPluginCapabilityPolicy({
      denylist: "pull-request-snapshot-provider:github",
    });

    expect(
      policy.evaluate({
        kind: "pull-request-snapshot-provider",
        provider: "github",
      }),
    ).toEqual({
      allowed: false,
      reason: "denylist",
      key: "pull-request-snapshot-provider:github",
    });
  });

  it("enforces allowlist when configured", () => {
    const policy = createPluginCapabilityPolicy({
      allowlist: "pull-request-snapshot-provider:sample",
    });

    expect(
      policy.evaluate({
        kind: "pull-request-snapshot-provider",
        provider: "github",
      }),
    ).toEqual({
      allowed: false,
      reason: "allowlist",
      key: "pull-request-snapshot-provider:github",
    });

    expect(
      policy.evaluate({
        kind: "pull-request-snapshot-provider",
        provider: "sample",
      }),
    ).toEqual({ allowed: true });
  });
});

