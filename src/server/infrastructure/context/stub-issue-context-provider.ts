import type {
  CodeHostIssueContextRef,
  IssueContextProvider,
  IssueContextRecord,
} from "@/server/application/ports/issue-context-provider";

function toIssueKey(reference: {
  provider: CodeHostIssueContextRef["provider"];
  owner: string;
  repository: string;
  issueNumber: number;
}): string {
  return `${reference.provider}:${reference.owner.toLowerCase()}/${reference.repository.toLowerCase()}#${reference.issueNumber}`;
}

export interface StubIssueContextProviderOptions {
  issues?: IssueContextRecord[];
}

export class StubIssueContextProvider implements IssueContextProvider {
  private readonly issueMap = new Map<string, IssueContextRecord>();

  constructor(options: StubIssueContextProviderOptions = {}) {
    for (const issue of options.issues ?? []) {
      this.issueMap.set(toIssueKey(issue), issue);
    }
  }

  async fetchIssue(input: {
    reference: CodeHostIssueContextRef;
    accessToken?: string | null;
  }): Promise<IssueContextRecord | null> {
    const issue = this.issueMap.get(toIssueKey(input.reference));
    return issue ?? null;
  }

  async fetchIssuesByNumbers(input: {
    provider: CodeHostIssueContextRef["provider"];
    owner: string;
    repository: string;
    issueNumbers: number[];
    accessToken?: string | null;
  }): Promise<IssueContextRecord[]> {
    const uniqueNumbers = [...new Set(input.issueNumbers.filter((number) => Number.isInteger(number) && number > 0))];
    const issues: IssueContextRecord[] = [];

    for (const issueNumber of uniqueNumbers) {
      const issue = await this.fetchIssue({
        reference: {
          provider: input.provider,
          owner: input.owner,
          repository: input.repository,
          issueNumber,
        },
        accessToken: input.accessToken,
      });

      if (issue) {
        issues.push(issue);
      }
    }

    return issues;
  }
}
