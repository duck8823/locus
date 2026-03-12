export interface GitHubIssueContextRef {
  provider: "github";
  owner: string;
  repository: string;
  issueNumber: number;
}

export type CodeHostIssueContextRef = GitHubIssueContextRef;

export interface IssueContextLabel {
  name: string;
  color: string | null;
}

export interface IssueContextAuthor {
  login: string;
}

export interface IssueContextRecord {
  provider: CodeHostIssueContextRef["provider"];
  owner: string;
  repository: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: IssueContextLabel[];
  author: IssueContextAuthor | null;
  htmlUrl: string;
  updatedAt: string;
}

export interface IssueContextProvider {
  fetchIssue(input: {
    reference: CodeHostIssueContextRef;
    accessToken?: string | null;
  }): Promise<IssueContextRecord | null>;

  fetchIssuesByNumbers(input: {
    provider: CodeHostIssueContextRef["provider"];
    owner: string;
    repository: string;
    issueNumbers: number[];
    accessToken?: string | null;
  }): Promise<IssueContextRecord[]>;
}
