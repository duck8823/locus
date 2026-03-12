export type PullRequestSourceProvider = string;

export interface PullRequestSourceRef {
  provider: PullRequestSourceProvider;
  [key: string]: unknown;
}

export interface PullRequestSnapshotBundle {
  title: string;
  repositoryName: string;
  branchLabel: string;
  snapshotPairs: unknown[];
  source: PullRequestSourceRef;
}

export interface ProviderAgnosticPullRequestSnapshotProvider {
  fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: PullRequestSourceRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle>;
}

export const PLUGIN_SDK_VERSION = 1 as const;

export type PluginCapabilityKind = "pull-request-snapshot-provider";

export interface PullRequestSnapshotProviderCapabilityManifest {
  kind: "pull-request-snapshot-provider";
  provider: PullRequestSourceProvider;
}

export type PluginCapabilityManifest = PullRequestSnapshotProviderCapabilityManifest;

export interface PluginManifest {
  pluginId: string;
  displayName: string;
  version: string;
  sdkVersion: typeof PLUGIN_SDK_VERSION;
  capabilities: PluginCapabilityManifest[];
}

export interface PluginRuntimeLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface PluginActivationContext {
  signal: AbortSignal;
  logger: PluginRuntimeLogger;
}

export interface PullRequestSnapshotProviderCapabilityBinding {
  kind: "pull-request-snapshot-provider";
  provider: PullRequestSourceProvider;
  implementation: ProviderAgnosticPullRequestSnapshotProvider;
}

export type PluginCapabilityBinding = PullRequestSnapshotProviderCapabilityBinding;

export interface PluginActivationResult {
  capabilities: PluginCapabilityBinding[];
  deactivate?: () => void | Promise<void>;
}

export interface CodeHostPlugin {
  manifest: PluginManifest;
  activate(
    context: PluginActivationContext,
  ): PluginActivationResult | Promise<PluginActivationResult>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function capabilityKey(capability: { kind: string; provider: string }): string {
  return `${capability.kind}:${capability.provider}`;
}

export function validatePluginManifest(manifest: PluginManifest): string[] {
  const issues: string[] = [];

  if (!isNonEmptyString(manifest.pluginId)) {
    issues.push("manifest.pluginId must be a non-empty string");
  }

  if (!isNonEmptyString(manifest.displayName)) {
    issues.push("manifest.displayName must be a non-empty string");
  }

  if (!isNonEmptyString(manifest.version)) {
    issues.push("manifest.version must be a non-empty string");
  }

  if (manifest.sdkVersion !== PLUGIN_SDK_VERSION) {
    issues.push(`manifest.sdkVersion must be ${PLUGIN_SDK_VERSION}`);
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    issues.push("manifest.capabilities must contain at least one capability");
    return issues;
  }

  const seen = new Set<string>();

  manifest.capabilities.forEach((capability, index) => {
    if (!isObjectRecord(capability)) {
      issues.push(`manifest.capabilities[${index}] must be an object`);
      return;
    }

    if (capability.kind !== "pull-request-snapshot-provider") {
      issues.push(`manifest.capabilities[${index}].kind is unsupported`);
      return;
    }

    if (!isNonEmptyString(capability.provider)) {
      issues.push(`manifest.capabilities[${index}].provider must be a non-empty string`);
      return;
    }

    const key = capabilityKey({ kind: capability.kind, provider: capability.provider });

    if (seen.has(key)) {
      issues.push(`manifest.capabilities contains duplicate capability: ${key}`);
      return;
    }

    seen.add(key);
  });

  return issues;
}

export function validatePluginActivationResult(input: {
  manifest: PluginManifest;
  result: unknown;
}): string[] {
  const issues: string[] = [];

  if (!isObjectRecord(input.result)) {
    issues.push("activation result must be an object");
    return issues;
  }

  const capabilities = input.result.capabilities;

  if (!Array.isArray(capabilities)) {
    issues.push("activation result must contain capabilities array");
    return issues;
  }

  const declaredCapabilityKeys = new Set(
    input.manifest.capabilities.map((capability) => capabilityKey(capability)),
  );
  const resolvedCapabilityKeys = new Set<string>();

  capabilities.forEach((capability, index) => {
    if (!isObjectRecord(capability)) {
      issues.push(`activation.capabilities[${index}] must be an object`);
      return;
    }

    if (capability.kind !== "pull-request-snapshot-provider") {
      issues.push(`activation.capabilities[${index}].kind is unsupported`);
      return;
    }

    if (!isNonEmptyString(capability.provider)) {
      issues.push(`activation.capabilities[${index}].provider must be a non-empty string`);
      return;
    }

    if (
      !isObjectRecord(capability.implementation) ||
      typeof capability.implementation.fetchPullRequestSnapshots !== "function"
    ) {
      issues.push(
        `activation.capabilities[${index}].implementation.fetchPullRequestSnapshots must be a function`,
      );
      return;
    }

    const key = capabilityKey({ kind: capability.kind, provider: capability.provider });

    if (resolvedCapabilityKeys.has(key)) {
      issues.push(`activation.capabilities contains duplicate capability implementation: ${key}`);
      return;
    }

    resolvedCapabilityKeys.add(key);

    if (!declaredCapabilityKeys.has(key)) {
      issues.push(`activation.capabilities includes undeclared capability: ${key}`);
    }
  });

  for (const declaredCapabilityKey of declaredCapabilityKeys) {
    if (!resolvedCapabilityKeys.has(declaredCapabilityKey)) {
      issues.push(`activation.capabilities missing declared capability: ${declaredCapabilityKey}`);
    }
  }

  return issues;
}

export function isCodeHostPlugin(value: unknown): value is CodeHostPlugin {
  if (!isObjectRecord(value)) {
    return false;
  }

  const manifest = value.manifest;

  if (!isObjectRecord(manifest)) {
    return false;
  }

  if (!Array.isArray(manifest.capabilities)) {
    return false;
  }

  if (typeof value.activate !== "function") {
    return false;
  }

  return true;
}
