import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_SDK_VERSION,
  type CodeHostPlugin,
} from "@/server/application/plugins/plugin-sdk";
import {
  PluginCapabilityUnavailableError,
  PluginRuntime,
} from "@/server/infrastructure/plugins/plugin-runtime";
import { sampleCodeHostPlugin } from "@/server/infrastructure/plugins/sample/sample-codehost-plugin";

class PullRequestProviderAuthError extends Error {
  constructor(message = "auth error") {
    super(message);
    this.name = "PullRequestProviderAuthError";
  }
}

describe("PluginRuntime", () => {
  it("loads sample plugin and resolves provider capability", async () => {
    const runtime = new PluginRuntime();
    const record = await runtime.loadPlugin({
      plugin: sampleCodeHostPlugin,
      source: "sample",
    });
    const provider = runtime.createPullRequestSnapshotProvider();
    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "review-1",
      source: {
        provider: "sample",
        owner: "duck8823",
        repository: "locus",
        pullRequestNumber: 1,
      },
    });

    expect(record.status).toBe("active");
    expect(bundle.source).toMatchObject({
      provider: "sample",
      pullRequestNumber: 1,
    });
  });

  it("skips plugin when capability provider is already registered", async () => {
    const runtime = new PluginRuntime();
    await runtime.loadPlugin({
      plugin: sampleCodeHostPlugin,
      source: "sample-1",
    });

    const skipped = await runtime.loadPlugin({
      plugin: {
        ...sampleCodeHostPlugin,
        manifest: {
          ...sampleCodeHostPlugin.manifest,
          pluginId: "sample.codehost.2",
        },
      },
      source: "sample-2",
    });

    expect(skipped).toMatchObject({
      status: "skipped",
      reason: "capability_already_registered:pull-request-snapshot-provider:sample",
    });
  });

  it("disables plugin when capability execution throws non-auth error", async () => {
    const deactivate = vi.fn();
    const unstablePlugin: CodeHostPlugin = {
      manifest: {
        pluginId: "unstable.plugin",
        displayName: "Unstable Plugin",
        version: "0.1.0",
        sdkVersion: PLUGIN_SDK_VERSION,
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "unstable",
          },
        ],
      },
      activate: async () => ({
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "unstable",
            implementation: {
              fetchPullRequestSnapshots: async () => {
                throw new Error("boom");
              },
            },
          },
        ],
        deactivate,
      }),
    };
    const runtime = new PluginRuntime();
    await runtime.loadPlugin({
      plugin: unstablePlugin,
      source: "unstable",
    });
    const provider = runtime.createPullRequestSnapshotProvider();

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: { provider: "unstable" },
      }),
    ).rejects.toThrow("boom");
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(runtime.listPluginStatuses()).toContainEqual({
      pluginId: "unstable.plugin",
      status: "disabled",
      reason: "capability_execution_failed:unstable",
    });
    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: { provider: "unstable" },
      }),
    ).rejects.toBeInstanceOf(PluginCapabilityUnavailableError);
  });

  it("keeps plugin active for auth errors to allow re-auth flow", async () => {
    const authPlugin: CodeHostPlugin = {
      manifest: {
        pluginId: "auth.plugin",
        displayName: "Auth Plugin",
        version: "0.1.0",
        sdkVersion: PLUGIN_SDK_VERSION,
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "authz",
          },
        ],
      },
      activate: async () => ({
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "authz",
            implementation: {
              fetchPullRequestSnapshots: async () => {
                throw new PullRequestProviderAuthError("expired token");
              },
            },
          },
        ],
      }),
    };
    const runtime = new PluginRuntime();
    await runtime.loadPlugin({
      plugin: authPlugin,
      source: "auth",
    });
    const provider = runtime.createPullRequestSnapshotProvider();

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: { provider: "authz" },
      }),
    ).rejects.toBeInstanceOf(PullRequestProviderAuthError);
    expect(runtime.listPluginStatuses()).toContainEqual({
      pluginId: "auth.plugin",
      status: "active",
      reason: null,
    });
  });
});
