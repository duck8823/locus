import type { IntegrationFailureReasonCode } from "@/server/application/services/classify-integration-failure";

export interface ConfluencePageContextRecord {
  provider: "confluence";
  pageId: string;
  spaceKey: string | null;
  title: string;
  summary: string | null;
  url: string;
  updatedAt: string;
}

export class ConfluenceContextProviderTemporaryError extends Error {
  readonly code = "CONFLUENCE_CONTEXT_PROVIDER_TEMPORARY";
  readonly retryable = true as const;

  constructor(
    message: string,
    readonly reasonCode: IntegrationFailureReasonCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConfluenceContextProviderTemporaryError";
  }
}

export class ConfluenceContextProviderPermanentError extends Error {
  readonly code = "CONFLUENCE_CONTEXT_PROVIDER_PERMANENT";
  readonly retryable = false as const;

  constructor(
    message: string,
    readonly reasonCode: IntegrationFailureReasonCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConfluenceContextProviderPermanentError";
  }
}

export type ConfluenceContextProviderError =
  | ConfluenceContextProviderTemporaryError
  | ConfluenceContextProviderPermanentError;

export interface ConfluenceContextProvider {
  searchPagesForReviewContext(input: {
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    accessToken: string | null;
  }): Promise<ConfluencePageContextRecord[]>;
}
