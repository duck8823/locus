import type { ConnectionTokenRepository } from "@/server/application/ports/connection-token-repository";
import type {
  IssueContextProvider,
  IssueContextRecord,
} from "@/server/application/ports/issue-context-provider";
import { resolveGitHubIssueContextAccess } from "@/server/application/services/resolve-github-issue-context-access";

export interface FetchGitHubIssueContextRecordsInput {
  reviewerId: string;
  owner: string;
  repository: string;
  issueNumbers: number[];
}

export interface FetchGitHubIssueContextRecordsDependencies {
  connectionTokenRepository: ConnectionTokenRepository;
  issueContextProvider: IssueContextProvider;
}

export class FetchGitHubIssueContextRecordsService {
  constructor(private readonly dependencies: FetchGitHubIssueContextRecordsDependencies) {}

  async execute(input: FetchGitHubIssueContextRecordsInput): Promise<IssueContextRecord[]> {
    const issueNumbers = [...new Set(input.issueNumbers.filter((number) => Number.isInteger(number) && number > 0))];

    if (issueNumbers.length === 0) {
      return [];
    }

    const access = await resolveGitHubIssueContextAccess({
      reviewerId: input.reviewerId,
      connectionTokenRepository: this.dependencies.connectionTokenRepository,
    });

    return this.dependencies.issueContextProvider.fetchIssuesByNumbers({
      provider: "github",
      owner: input.owner,
      repository: input.repository,
      issueNumbers,
      accessToken: access.accessToken,
    });
  }
}
