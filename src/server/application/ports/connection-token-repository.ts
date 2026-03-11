export interface PersistedConnectionToken {
  reviewerId: string;
  provider: "github";
  accessToken: string;
  tokenType: string | null;
  scope: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface UpsertConnectionTokenInput {
  reviewerId: string;
  provider: "github";
  accessToken: string;
  tokenType: string | null;
  scope: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface ConnectionTokenRepository {
  upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken>;
  findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null>;
}
