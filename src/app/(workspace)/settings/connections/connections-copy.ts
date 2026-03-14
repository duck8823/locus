import type { ConnectionProviderKey } from "@/server/application/services/connection-catalog";

export type ConnectionsLocale = "en" | "ja";
export type TransitionHistoryReason = "manual" | "token-expired" | "webhook";

export const connectionsCopyByLocale = {
  en: {
    backToHome: "← Back to home",
    title: "Connections",
    authStub: "Connection model stub",
    description:
      "This page validates the connection-state contract before implementing actual OAuth flows.",
    reviewerIdentity: "Current reviewer identity",
    signedOut: "Signed out",
    languageLabel: "Language",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    generatedAt: "Catalog generated at",
    statusLabel: "Status",
    authModeLabel: "Auth mode",
    updatedAtLabel: "Updated at",
    accountLabel: "Connected account",
    stateSourceLabel: "State source",
    capabilitiesLabel: "Capabilities",
    supportsWebhook: "Webhook",
    supportsIssueContext: "Issue context",
    transitionLabel: "Change state",
    transitionButton: "Apply",
    oauthConnectButton: "Connect with GitHub OAuth",
    oauthReconnectButton: "Reconnect GitHub OAuth",
    manualOverrideSummary: "Advanced: manual state override",
    manualOverrideDescription:
      "Use only for prototype diagnostics. OAuth flow should be the default path.",
    transitionUnavailable:
      "State transition is not available for this provider in current status.",
    connectedAccountInputLabel: "Account label (optional)",
    connectedAccountPlaceholder: "e.g. duck8823",
    providerNotesLabel: "Provider notes",
    transitionHistoryLabel: "Recent transitions",
    noTransitionHistory: "No transitions recorded yet.",
    changedAtLabel: "Changed at",
    reasonLabel: "Reason",
    actorLabel: "Actor",
    historyReasonFilterLabel: "History filter",
    historyReasonFilterAll: "All reasons",
    historyPageLabel: "Page",
    historyPageSizeLabel: "Rows",
    historyApplyButton: "Apply",
    previousPage: "Previous",
    nextPage: "Next",
    emptyValueLabel: "None",
    authModeByKey: {
      oauth: "OAuth",
      none: "None",
    },
    capabilityFlagByKey: {
      enabled: "Enabled",
      disabled: "Disabled",
    },
    oauthSuccessByCode: {
      github_connected: "GitHub connection completed.",
    },
    oauthErrorByCode: {
      oauth_start_failed: "Failed to start OAuth flow. Please try again.",
      oauth_provider_rejected: "GitHub canceled or rejected the OAuth request.",
      oauth_callback_invalid: "OAuth callback payload is incomplete.",
      oauth_callback_retryable:
        "OAuth callback failed due to a temporary upstream error. Please retry.",
      oauth_callback_failed: "OAuth callback processing failed. Please retry.",
    },
    statusByKey: {
      not_connected: "Not connected",
      planned: "Planned",
      connected: "Connected",
      reauth_required: "Re-auth required",
    },
    transitionReasonByKey: {
      manual: "Manual",
      "token-expired": "Token expired",
      webhook: "Webhook",
    },
    transitionActorByKey: {
      reviewer: "Reviewer",
      system: "System",
    },
    stateSourceByKey: {
      catalog_default: "Catalog default",
      persisted: "Persisted state",
    },
    providerByKey: {
      github: "GitHub",
      confluence: "Confluence",
      jira: "Jira",
    },
    providerDescriptionByKey: {
      github:
        "OAuth endpoints are next. This card tracks provider identity and lifecycle state.",
      confluence:
        "Context overlay integration is planned after the first hosted review loop stabilizes.",
      jira:
        "Issue-linking support is modeled in the contract and deferred from MVP v0.",
    },
  },
  ja: {
    backToHome: "← ホームへ戻る",
    title: "接続設定",
    authStub: "接続モデルスタブ",
    description:
      "OAuth 実装前に、接続状態の契約（状態モデル）を先に検証するページです。",
    reviewerIdentity: "現在のレビュアーID",
    signedOut: "未ログイン",
    languageLabel: "表示言語",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
    generatedAt: "カタログ生成時刻",
    statusLabel: "状態",
    authModeLabel: "認証方式",
    updatedAtLabel: "更新時刻",
    accountLabel: "接続アカウント",
    stateSourceLabel: "状態ソース",
    capabilitiesLabel: "機能",
    supportsWebhook: "Webhook",
    supportsIssueContext: "Issue コンテキスト",
    transitionLabel: "状態変更",
    transitionButton: "適用",
    oauthConnectButton: "GitHub OAuthで接続",
    oauthReconnectButton: "GitHub OAuthで再接続",
    manualOverrideSummary: "詳細: 手動状態変更（上級者向け）",
    manualOverrideDescription:
      "プロトタイプ検証用です。通常は OAuth フローを優先してください。",
    transitionUnavailable: "現在の状態では、このプロバイダーの状態変更はできません。",
    connectedAccountInputLabel: "接続アカウント名（任意）",
    connectedAccountPlaceholder: "例: duck8823",
    providerNotesLabel: "プロバイダーメモ",
    transitionHistoryLabel: "最近の状態変更",
    noTransitionHistory: "状態変更履歴はまだありません。",
    changedAtLabel: "変更時刻",
    reasonLabel: "理由",
    actorLabel: "変更主体",
    historyReasonFilterLabel: "履歴フィルター",
    historyReasonFilterAll: "すべての理由",
    historyPageLabel: "ページ",
    historyPageSizeLabel: "表示件数",
    historyApplyButton: "適用",
    previousPage: "前へ",
    nextPage: "次へ",
    emptyValueLabel: "なし",
    authModeByKey: {
      oauth: "OAuth",
      none: "なし",
    },
    capabilityFlagByKey: {
      enabled: "対応",
      disabled: "未対応",
    },
    oauthSuccessByCode: {
      github_connected: "GitHub 接続が完了しました。",
    },
    oauthErrorByCode: {
      oauth_start_failed: "OAuth 開始に失敗しました。もう一度お試しください。",
      oauth_provider_rejected: "GitHub 側で OAuth 要求が拒否またはキャンセルされました。",
      oauth_callback_invalid: "OAuth コールバックのパラメータが不足しています。",
      oauth_callback_retryable:
        "OAuth コールバックが一時的な上流エラーで失敗しました。再試行してください。",
      oauth_callback_failed: "OAuth コールバック処理に失敗しました。再試行してください。",
    },
    statusByKey: {
      not_connected: "未接続",
      planned: "計画中",
      connected: "接続済み",
      reauth_required: "再認証が必要",
    },
    transitionReasonByKey: {
      manual: "手動操作",
      "token-expired": "トークン期限切れ",
      webhook: "Webhook",
    },
    transitionActorByKey: {
      reviewer: "レビュアー",
      system: "システム",
    },
    stateSourceByKey: {
      catalog_default: "カタログ既定値",
      persisted: "永続化状態",
    },
    providerByKey: {
      github: "GitHub",
      confluence: "Confluence",
      jira: "Jira",
    },
    providerDescriptionByKey: {
      github:
        "次段で OAuth を実装予定。ここではプロバイダー識別子と状態遷移を固定します。",
      confluence:
        "コンテキストオーバーレイ連携は、ホスト連携フロー安定化後に実装します。",
      jira:
        "Issue 連携は契約のみ準備し、MVP v0 の実装スコープからは外しています。",
    },
  },
} as const;

export type ConnectionsCopy = (typeof connectionsCopyByLocale)[ConnectionsLocale];

export function formatProvider(provider: ConnectionProviderKey | string, locale: ConnectionsLocale): string {
  return connectionsCopyByLocale[locale].providerByKey[provider as ConnectionProviderKey] ?? provider;
}

export function formatStatus(status: string, locale: ConnectionsLocale): string {
  const translated = connectionsCopyByLocale[locale].statusByKey[
    status as keyof typeof connectionsCopyByLocale.en.statusByKey
  ];

  if (translated) {
    return translated;
  }

  return status.replaceAll("_", " ");
}

export function formatTransitionOption(status: string, locale: ConnectionsLocale): string {
  return formatStatus(status, locale);
}

export function formatTransitionReason(reason: TransitionHistoryReason, locale: ConnectionsLocale): string {
  return connectionsCopyByLocale[locale].transitionReasonByKey[reason];
}

export function formatTransitionActor(input: {
  actorType: "reviewer" | "system";
  actorId: string | null;
  locale: ConnectionsLocale;
}): string {
  const actorLabel = connectionsCopyByLocale[input.locale].transitionActorByKey[input.actorType];

  if (!input.actorId) {
    return actorLabel;
  }

  return `${actorLabel} (${input.actorId})`;
}

export function formatAuthMode(authMode: string, locale: ConnectionsLocale): string {
  const translated = connectionsCopyByLocale[locale].authModeByKey[
    authMode as keyof typeof connectionsCopyByLocale.en.authModeByKey
  ];

  if (translated) {
    return translated;
  }

  return authMode.replaceAll("_", " ");
}

export function formatStateSource(
  stateSource: "catalog_default" | "persisted",
  locale: ConnectionsLocale,
): string {
  return connectionsCopyByLocale[locale].stateSourceByKey[stateSource];
}

export function formatCapabilityFlag(enabled: boolean, locale: ConnectionsLocale): string {
  return enabled
    ? connectionsCopyByLocale[locale].capabilityFlagByKey.enabled
    : connectionsCopyByLocale[locale].capabilityFlagByKey.disabled;
}

export function formatConnectedAccountLabel(
  value: string | null,
  locale: ConnectionsLocale,
): string {
  if (value) {
    return value;
  }

  return connectionsCopyByLocale[locale].emptyValueLabel;
}

export function resolveOAuthFeedback(input: {
  successCode: string | null;
  errorCode: string | null;
  locale: ConnectionsLocale;
}): {
  kind: "success" | "error";
  message: string;
} | null {
  const localizedCopy = connectionsCopyByLocale[input.locale];

  if (input.successCode) {
    const successMessage =
      localizedCopy.oauthSuccessByCode[
        input.successCode as keyof typeof localizedCopy.oauthSuccessByCode
      ];

    if (successMessage) {
      return {
        kind: "success",
        message: successMessage,
      };
    }
  }

  if (input.errorCode) {
    const errorMessage =
      localizedCopy.oauthErrorByCode[
        input.errorCode as keyof typeof localizedCopy.oauthErrorByCode
      ];

    if (errorMessage) {
      return {
        kind: "error",
        message: errorMessage,
      };
    }
  }

  return null;
}
