export interface PendingOAuthState {
  state: string;
  provider: "github";
  reviewerId: string;
  redirectPath: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
}

export interface SavePendingOAuthStateInput {
  state: string;
  provider: "github";
  reviewerId: string;
  redirectPath: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthStateRepository {
  savePendingState(input: SavePendingOAuthStateInput): Promise<PendingOAuthState>;
  consumePendingState(state: string): Promise<PendingOAuthState | null>;
}
