import type { PluginCapabilityKind } from "@/server/application/plugins/plugin-sdk";
import type { PullRequestSourceProvider } from "@/server/application/ports/pull-request-snapshot-provider";

export type PluginCapabilityPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "denylist" | "allowlist";
      key: string;
    };

export interface PluginCapabilityPolicy {
  evaluate(input: {
    kind: PluginCapabilityKind;
    provider: PullRequestSourceProvider;
  }): PluginCapabilityPolicyDecision;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function parsePolicyKeys(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set<string>();
  }

  return new Set(
    raw
      .split(",")
      .map((token) => normalizeToken(token))
      .filter((token) => token.length > 0),
  );
}

function capabilityKey(input: {
  kind: PluginCapabilityKind;
  provider: PullRequestSourceProvider;
}): string {
  return `${normalizeToken(input.kind)}:${normalizeToken(input.provider)}`;
}

class DefaultPluginCapabilityPolicy implements PluginCapabilityPolicy {
  constructor(
    private readonly allowlist: Set<string>,
    private readonly denylist: Set<string>,
  ) {}

  evaluate(input: {
    kind: PluginCapabilityKind;
    provider: PullRequestSourceProvider;
  }): PluginCapabilityPolicyDecision {
    const key = capabilityKey(input);

    if (this.denylist.has(key)) {
      return {
        allowed: false,
        reason: "denylist",
        key,
      };
    }

    if (this.allowlist.size > 0 && !this.allowlist.has(key)) {
      return {
        allowed: false,
        reason: "allowlist",
        key,
      };
    }

    return { allowed: true };
  }
}

export function createPluginCapabilityPolicy(input: {
  allowlist?: string;
  denylist?: string;
} = {}): PluginCapabilityPolicy {
  return new DefaultPluginCapabilityPolicy(
    parsePolicyKeys(input.allowlist),
    parsePolicyKeys(input.denylist),
  );
}

