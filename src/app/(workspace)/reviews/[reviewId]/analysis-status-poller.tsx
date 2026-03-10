"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { resolveAnalysisPollIntervalMs } from "./analysis-status-polling-policy";
import type { ReviewWorkspaceDto } from "@/server/presentation/dto/review-workspace-dto";

interface AnalysisStatusPollerProps {
  active: boolean;
  reviewId: string;
  currentToken: string;
  analysisStatus: ReviewWorkspaceDto["analysisStatus"];
  reanalysisStatus: ReviewWorkspaceDto["reanalysisStatus"];
  analysisProcessedFiles: ReviewWorkspaceDto["analysisProcessedFiles"];
  analysisTotalFiles: ReviewWorkspaceDto["analysisTotalFiles"];
}

export function AnalysisStatusPoller({
  active,
  reviewId,
  currentToken,
  analysisStatus,
  reanalysisStatus,
  analysisProcessedFiles,
  analysisTotalFiles,
}: AnalysisStatusPollerProps) {
  const router = useRouter();
  const currentTokenRef = useRef(currentToken);

  useEffect(() => {
    currentTokenRef.current = currentToken;
  }, [currentToken]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let timeoutId: number | null = null;
    let stopped = false;

    const runPoll = async () => {
      if (stopped) {
        return;
      }

      const isDocumentVisible = document.visibilityState === "visible";

      if (isDocumentVisible) {
        try {
          const response = await fetch(
            `/api/reviews/${encodeURIComponent(reviewId)}/analysis-status`,
            {
              cache: "no-store",
              method: "GET",
            },
          );

          if (response.status === 404) {
            router.refresh();
            return;
          }

          if (response.ok) {
            const body = (await response.json()) as { token?: string };
            if (
              typeof body.token === "string" &&
              body.token !== currentTokenRef.current
            ) {
              router.refresh();
            }
          }
        } catch {
          // Ignore transient polling failures.
        }
      }

      const delayMs = resolveAnalysisPollIntervalMs({
        analysisStatus,
        reanalysisStatus,
        analysisProcessedFiles,
        analysisTotalFiles,
        isDocumentVisible,
      });
      timeoutId = window.setTimeout(runPoll, delayMs);
    };

    const initialDelayMs = resolveAnalysisPollIntervalMs({
      analysisStatus,
      reanalysisStatus,
      analysisProcessedFiles,
      analysisTotalFiles,
      isDocumentVisible: document.visibilityState === "visible",
    });
    timeoutId = window.setTimeout(runPoll, initialDelayMs);

    return () => {
      stopped = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    active,
    analysisProcessedFiles,
    reanalysisStatus,
    analysisStatus,
    analysisTotalFiles,
    reviewId,
    router,
  ]);

  return null;
}
