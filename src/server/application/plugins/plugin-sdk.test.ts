import { describe, expect, it } from "vitest";
import {
  PLUGIN_SDK_VERSION,
  type PullRequestSourceProvider,
  type PluginManifest,
  validatePluginManifest,
  validatePluginActivationResult,
} from "@/server/application/plugins/plugin-sdk";
import { sampleCodeHostPlugin } from "@/server/infrastructure/plugins/sample/sample-codehost-plugin";

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
                source: { provider: PullRequestSourceProvider };
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
                source: { provider: PullRequestSourceProvider };
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

  it("accepts the sample plugin contract", async () => {
    const manifestIssues = validatePluginManifest(sampleCodeHostPlugin.manifest);
    const activationResult = await sampleCodeHostPlugin.activate({
      signal: new AbortController().signal,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const activationIssues = validatePluginActivationResult({
      manifest: sampleCodeHostPlugin.manifest,
      result: activationResult,
    });

    expect(manifestIssues).toEqual([]);
    expect(activationIssues).toEqual([]);
  });
});
