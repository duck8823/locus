export interface OAuthCodeExchangeResult {
  accessToken: string;
  tokenType: string | null;
  scope: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
}

export interface ExchangeGitHubOAuthCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export class OAuthCodeExchangeTemporaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthCodeExchangeTemporaryError";
  }
}

export class OAuthCodeExchangeRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthCodeExchangeRejectedError";
  }
}

export interface OAuthCodeExchangeProvider {
  exchangeGitHubCode(input: ExchangeGitHubOAuthCodeInput): Promise<OAuthCodeExchangeResult>;
}
