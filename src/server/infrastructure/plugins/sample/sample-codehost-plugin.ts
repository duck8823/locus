import {
  PLUGIN_SDK_VERSION,
  type CodeHostPlugin,
} from "@/server/application/plugins/plugin-sdk";
import type {
  PullRequestSourceRef,
  ProviderAgnosticPullRequestSnapshotProvider,
} from "@/server/application/ports/pull-request-snapshot-provider";

interface SamplePullRequestRef extends PullRequestSourceRef {
  provider: "sample";
  owner: string;
  repository: string;
  pullRequestNumber: number;
}

function isSamplePullRequestRef(source: PullRequestSourceRef): source is SamplePullRequestRef {
  return (
    source.provider === "sample" &&
    typeof source.owner === "string" &&
    source.owner.length > 0 &&
    typeof source.repository === "string" &&
    source.repository.length > 0 &&
    typeof source.pullRequestNumber === "number" &&
    Number.isInteger(source.pullRequestNumber)
  );
}

const sampleSnapshotProvider: ProviderAgnosticPullRequestSnapshotProvider = {
  async fetchPullRequestSnapshots(input) {
    if (!isSamplePullRequestRef(input.source)) {
      throw new Error("sample plugin received incompatible pull request source");
    }

    return {
      title: `Sample PR #${input.source.pullRequestNumber}`,
      repositoryName: `${input.source.owner}/${input.source.repository}`,
      branchLabel: "sample/head → sample/base",
      snapshotPairs: [],
      source: input.source,
    };
  },
};

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
          implementation: sampleSnapshotProvider,
        },
      ],
    };
  },
};

export default sampleCodeHostPlugin;
