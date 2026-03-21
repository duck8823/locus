"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiSuggestion } from "@/server/application/ai/ai-suggestion-types";

export interface AiSuggestionStreamState {
  suggestions: AiSuggestion[];
  isStreaming: boolean;
  error: string | null;
  metadata: {
    provider: string | null;
    fallbackApplied: boolean;
    reasonCode: string | null;
  };
}

function subscribe(
  reviewId: string,
  setState: React.Dispatch<React.SetStateAction<AiSuggestionStreamState>>,
): () => void {
  setState({
    suggestions: [],
    isStreaming: true,
    error: null,
    metadata: { provider: null, fallbackApplied: false, reasonCode: null },
  });

  const eventSource = new EventSource(
    `/api/reviews/${encodeURIComponent(reviewId)}/ai-suggestions/stream`,
  );

  eventSource.addEventListener("suggestion", (event) => {
    try {
      const suggestion = JSON.parse(event.data) as AiSuggestion;
      setState((prev) => ({
        ...prev,
        suggestions: [...prev.suggestions, suggestion],
      }));
    } catch {
      // Ignore malformed suggestion events.
    }
  });

  eventSource.addEventListener("metadata", (event) => {
    try {
      const metadata = JSON.parse(event.data);
      setState((prev) => ({
        ...prev,
        metadata: {
          provider: metadata.provider ?? null,
          fallbackApplied: metadata.fallbackApplied ?? false,
          reasonCode: metadata.reasonCode ?? null,
        },
      }));
    } catch {
      // Ignore malformed metadata events.
    }
  });

  eventSource.addEventListener("done", () => {
    setState((prev) => ({ ...prev, isStreaming: false }));
    eventSource.close();
  });

  eventSource.addEventListener("error", () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: prev.error ?? "Connection closed",
      }));
    }
  });

  eventSource.onerror = () => {
    eventSource.close();
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      error: prev.error ?? "Stream connection failed",
    }));
  };

  return () => {
    eventSource.close();
  };
}

export function useAiSuggestionStream(
  reviewId: string,
  options: { enabled?: boolean } = {},
): AiSuggestionStreamState & { retry: () => void } {
  const enabled = options.enabled ?? false;
  const [state, setState] = useState<AiSuggestionStreamState>({
    suggestions: [],
    isStreaming: false,
    error: null,
    metadata: { provider: null, fallbackApplied: false, reasonCode: null },
  });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribe(reviewId, setState);
  }, [reviewId, enabled, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { ...state, retry };
}
