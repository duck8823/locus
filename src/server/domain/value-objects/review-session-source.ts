export interface GitHubReviewSessionSource {
  provider: "github";
  owner: string;
  repository: string;
  pullRequestNumber: number;
  [key: string]: unknown;
}

export interface SeedFixtureReviewSessionSource {
  provider: "seed_fixture";
  fixtureId: string;
}

export type ReviewSessionSource = GitHubReviewSessionSource | SeedFixtureReviewSessionSource;
