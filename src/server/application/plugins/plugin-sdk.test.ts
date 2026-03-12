import { describe, expect, it } from "vitest";
import {
  PLUGIN_SDK_VERSION,
  type CodeHostPlugin,
  type PullRequestSourceProvider,
  type PluginManifest,
  validatePluginManifest,
  validatePluginActivationResult,
} from "@/server/application/plugins/plugin-sdk";

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

  it("rejects non-object capabilities in manifest", () => {
    const issues = validatePluginManifest(
      createManifest({
        capabilities: [null as never],
      }),
    );

    expect(issues).toContain("manifest.capabilities[0] must be an object");
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

  it("rejects non-object activation results", () => {
    const issues = validatePluginActivationResult({
      manifest: createManifest(),
      result: null,
    });

    expect(issues).toEqual(["activation result must be an object"]);
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

  it("rejects non-object capabilities from activation", () => {
    const issues = validatePluginActivationResult({
      manifest: createManifest(),
      result: {
        capabilities: [null],
      },
    });

    expect(issues).toContain("activation.capabilities[0] must be an object");
  });

  it("accepts the sample plugin contract", async () => {
    const samplePlugin: CodeHostPlugin = {
      manifest: createManifest({
        pluginId: "sample.codehost",
        displayName: "Sample CodeHost Plugin",
      }),
      activate: async () => ({
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
                branchLabel: "feature → main",
                snapshotPairs: [],
                source: input.source,
              }),
            },
          },
        ],
      }),
    };
    const manifestIssues = validatePluginManifest(samplePlugin.manifest);
    const activationResult = await samplePlugin.activate({
      signal: new AbortController().signal,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    const activationIssues = validatePluginActivationResult({
      manifest: samplePlugin.manifest,
      result: activationResult,
    });

    expect(manifestIssues).toEqual([]);
    expect(activationIssues).toEqual([]);
  });
});
