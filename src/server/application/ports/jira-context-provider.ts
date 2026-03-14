import type { IntegrationFailureReasonCode } from "@/server/application/services/classify-integration-failure";

export interface JiraIssueContextRecord {
  provider: "jira";
  issueKey: string;
  title: string;
  summary: string | null;
  url: string;
  status: string | null;
  updatedAt: string;
}

export class JiraContextProviderTemporaryError extends Error {
  readonly code = "JIRA_CONTEXT_PROVIDER_TEMPORARY";
  readonly retryable = true as const;

  constructor(
    message: string,
    readonly reasonCode: IntegrationFailureReasonCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JiraContextProviderTemporaryError";
  }
}

export class JiraContextProviderPermanentError extends Error {
  readonly code = "JIRA_CONTEXT_PROVIDER_PERMANENT";
  readonly retryable = false as const;

  constructor(
    message: string,
    readonly reasonCode: IntegrationFailureReasonCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JiraContextProviderPermanentError";
  }
}

export type JiraContextProviderError =
  | JiraContextProviderTemporaryError
  | JiraContextProviderPermanentError;

export interface JiraContextProvider {
  searchIssuesForReviewContext(input: {
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    accessToken: string | null;
  }): Promise<JiraIssueContextRecord[]>;
}
