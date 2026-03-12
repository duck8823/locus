import { describe, expect, it } from "vitest";
import {
  PLUGIN_SDK_VERSION,
  type PluginManifest,
  validatePluginActivationResult,
  validatePluginManifest,
} from "@/server/application/plugins/plugin-sdk";
import type { PullRequestSourceRef } from "@/server/application/ports/pull-request-snapshot-provider";

function createManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    pluginId: "acme.sample",
    displayName: "ACME Sample",
    version: "0.1.0",
    sdkVersion: PLUGIN_SDK_VERSION,
    capabilities: [
      {
        kind: "pull-request-snapshot-provider",
        provider: "sample",
      },
    ],
    ...overrides,
  };
}

describe("plugin-sdk contract", () => {
  it("accepts a valid plugin manifest", () => {
    expect(validatePluginManifest(createManifest())).toEqual([]);
  });

  it("rejects duplicate manifest capabilities", () => {
    const issues = validatePluginManifest(
      createManifest({
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "sample",
          },
          {
            kind: "pull-request-snapshot-provider",
            provider: "sample",
          },
        ],
      }),
    );

    expect(issues).toContain(
      "manifest.capabilities contains duplicate capability: pull-request-snapshot-provider:sample",
    );
  });

  it("requires declared capabilities to be implemented at activation", () => {
    const issues = validatePluginActivationResult({
      manifest: createManifest(),
      result: {
        capabilities: [],
      },
    });

    expect(issues).toContain(
      "activation.capabilities missing declared capability: pull-request-snapshot-provider:sample",
    );
  });

  it("rejects undeclared capabilities from activation", () => {
    const issues = validatePluginActivationResult({
      manifest: createManifest(),
      result: {
        capabilities: [
          {
            kind: "pull-request-snapshot-provider",
            provider: "sample",
            implementation: {
              fetchPullRequestSnapshots: async (input: {
                reviewId: string;
                source: PullRequestSourceRef;
              }) => ({
                title: input.reviewId,
                repositoryName: "sample/repo",
                branchLabel: "head → base",
                snapshotPairs: [],
                source: input.source,
              }),
            },
          },
          {
            kind: "pull-request-snapshot-provider",
            provider: "other",
            implementation: {
              fetchPullRequestSnapshots: async (input: {
                reviewId: string;
                source: PullRequestSourceRef;
              }) => ({
                title: input.reviewId,
                repositoryName: "other/repo",
                branchLabel: "head → base",
                snapshotPairs: [],
                source: input.source,
              }),
            },
          },
        ],
      },
    });

    expect(issues).toContain(
      "activation.capabilities includes undeclared capability: pull-request-snapshot-provider:other",
    );
  });
});
