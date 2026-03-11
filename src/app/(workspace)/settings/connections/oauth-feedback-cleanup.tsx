"use client";

import { useEffect } from "react";

const OAUTH_FEEDBACK_QUERY_KEYS = ["oauthSuccess", "oauthError"] as const;

export function OAuthFeedbackCleanup() {
  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    let modified = false;

    for (const queryKey of OAUTH_FEEDBACK_QUERY_KEYS) {
      if (currentUrl.searchParams.has(queryKey)) {
        currentUrl.searchParams.delete(queryKey);
        modified = true;
      }
    }

    if (!modified) {
      return;
    }

    const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState(window.history.state, "", nextPath);
  }, []);

  return null;
}
