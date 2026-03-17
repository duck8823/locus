"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const retryCountRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }

    setState((prev) => ({
      ...prev,
      suggestions: [],
      isStreaming: true,
      error: null,
    }));

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

    eventSource.addEventListener("error", (event) => {
      // EventSource "error" can mean connection loss or server-sent error
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
  }, [reviewId, enabled]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  const retry = useCallback(() => {
    retryCountRef.current += 1;
    connect();
  }, [connect]);

  return { ...state, retry };
}
