import {
  PLUGIN_SDK_VERSION,
  type CodeHostPlugin,
} from "@/server/application/plugins/plugin-sdk";

export const sampleCodeHostPlugin: CodeHostPlugin = {
  manifest: {
    pluginId: "sample.codehost",
    displayName: "Sample Codehost Plugin",
    version: "0.1.0",
    sdkVersion: PLUGIN_SDK_VERSION,
    capabilities: [
      {
        kind: "pull-request-snapshot-provider",
        provider: "sample",
      },
    ],
  },
  activate() {
    return {
      capabilities: [
        {
          kind: "pull-request-snapshot-provider",
          provider: "sample",
          implementation: {
            async fetchPullRequestSnapshots(input) {
              return {
                title: `Sample PR for ${input.reviewId}`,
                repositoryName: "sample/repo",
                branchLabel: "sample/head → sample/base",
                snapshotPairs: [],
                source: input.source,
              };
            },
          },
        },
      ],
    };
  },
};

export default sampleCodeHostPlugin;
