export interface GitHubReviewSessionSource {
  provider: "github";
  owner: string;
  repository: string;
  pullRequestNumber: number;
  [key: string]: unknown;
}

export interface GitLabReviewSessionSource {
  provider: "gitlab";
  projectPath: string;
  mergeRequestIid: number;
  [key: string]: unknown;
}

export interface SeedFixtureReviewSessionSource {
  provider: "seed_fixture";
  fixtureId: string;
}

export type ReviewSessionSource =
  | GitHubReviewSessionSource
  | GitLabReviewSessionSource
  | SeedFixtureReviewSessionSource;
