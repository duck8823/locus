"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import type { WorkspaceLocale } from "@/app/(workspace)/workspace-locale";
import {
  formatAiSuggestionCategory,
  formatAiSuggestionConfidence,
  localizeAiSuggestionText,
  workspaceCopyByLocale,
} from "@/app/(workspace)/reviews/[reviewId]/workspace-copy";
import type { ReviewWorkspaceAiSuggestionDto } from "@/server/presentation/dto/review-workspace-dto";

type SuggestionDecision = "adopted" | "holding";
type SuggestionDecisionMap = Record<string, SuggestionDecision>;

function readDecisionMap(storageKey: string): SuggestionDecisionMap {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: SuggestionDecisionMap = {};

    for (const [suggestionId, decision] of Object.entries(parsed)) {
      if (decision === "adopted" || decision === "holding") {
        result[suggestionId] = decision;
      }
    }

    return result;
  } catch {
    return {};
  }
}

function writeDecisionMap(storageKey: string, map: SuggestionDecisionMap): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // best-effort persistence only
  }
}

export function AiSuggestionPanel(props: {
  reviewId: string;
  locale: WorkspaceLocale;
  suggestions: ReviewWorkspaceAiSuggestionDto[];
}) {
  const copy = workspaceCopyByLocale[props.locale];
  const storageKey = useMemo(
    () => `locus-ai-suggestion-decisions:${props.reviewId}`,
    [props.reviewId],
  );
  const [decisionMap, setDecisionMap] = useState<SuggestionDecisionMap>({});

  useEffect(() => {
    setDecisionMap(readDecisionMap(storageKey));
  }, [storageKey]);

  const setDecision = (suggestionId: string, decision: SuggestionDecision | null) => {
    setDecisionMap((previous) => {
      const next = { ...previous };

      if (decision === null) {
        delete next[suggestionId];
      } else {
        next[suggestionId] = decision;
      }

      writeDecisionMap(storageKey, next);
      return next;
    });
  };

  if (props.suggestions.length === 0) {
    return <p className={styles.muted}>{copy.text.noAiSuggestionsYet}</p>;
  }

  return (
    <ul className={styles.aiSuggestionList}>
      {props.suggestions.map((suggestion) => {
        const decision = decisionMap[suggestion.suggestionId] ?? null;
        const localizedText = localizeAiSuggestionText({
          locale: props.locale,
          suggestionId: suggestion.suggestionId,
          headline: suggestion.headline,
          recommendation: suggestion.recommendation,
          rationale: suggestion.rationale,
        });
        const decisionLabel =
          decision === "adopted"
            ? copy.text.aiDecisionAdopted
            : decision === "holding"
              ? copy.text.aiDecisionHolding
              : copy.text.aiDecisionNone;

        return (
          <li key={suggestion.suggestionId} className={styles.aiSuggestionCard} data-testid={`ai-suggestion-${suggestion.suggestionId}`}>
            <div className={styles.semanticChangeHeader}>
              <strong>{localizedText.headline}</strong>
              <span className={styles.changeBadge} data-change-type="modified">
                {decisionLabel}
              </span>
            </div>
            <p className={styles.semanticChangeMeta}>
              {copy.text.aiSuggestionCategory}:{" "}
              {formatAiSuggestionCategory(suggestion.category, props.locale)}
              {" · "}
              {copy.text.aiSuggestionConfidence}:{" "}
              {formatAiSuggestionConfidence(suggestion.confidence, props.locale)}
            </p>
            <p className={styles.groupSummary}>{localizedText.recommendation}</p>
            <p className={styles.muted}>{copy.text.aiSuggestionRationale}</p>
            <ul className={styles.aiSuggestionRationaleList}>
              {localizedText.rationale.map((item, index) => (
                <li key={`${suggestion.suggestionId}-rationale-${index}`} className={styles.semanticChangeMeta}>
                  {item}
                </li>
              ))}
            </ul>
            <div className={styles.analysisControls}>
              <button
                type="button"
                className={styles.statusButton}
                data-testid={`ai-suggestion-adopt-${suggestion.suggestionId}`}
                data-active={decision === "adopted"}
                onClick={() => setDecision(suggestion.suggestionId, "adopted")}
              >
                {copy.actions.adoptSuggestion}
              </button>
              <button
                type="button"
                className={styles.statusButton}
                data-active={decision === "holding"}
                onClick={() => setDecision(suggestion.suggestionId, "holding")}
              >
                {copy.actions.holdSuggestion}
              </button>
              <button
                type="button"
                className={styles.statusButton}
                onClick={() => setDecision(suggestion.suggestionId, null)}
              >
                {copy.actions.clearSuggestionDecision}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
