import { NextResponse } from "next/server";
import { getDependencies } from "@/server/composition/dependencies";
import {
  createAnalysisStatusToken,
  isActiveAnalysisStatus,
} from "@/server/presentation/formatters/analysis-status-token";

export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await context.params;
  const { reviewSessionRepository } = getDependencies();
  const reviewSession = await reviewSessionRepository.findByReviewId(reviewId);

  if (!reviewSession) {
    return NextResponse.json(
      { error: `Review session not found: ${reviewId}` },
      { status: 404 },
    );
  }

  const record = reviewSession.toRecord();
  const analysisStatus = record.analysisStatus ?? "ready";
  const payload = {
    reviewId,
    analysisStatus,
    analysisRequestedAt: record.analysisRequestedAt ?? null,
    analysisCompletedAt: record.analysisCompletedAt ?? null,
    analysisProcessedFiles: record.analysisProcessedFiles ?? null,
    analysisTotalFiles: record.analysisTotalFiles ?? null,
    analysisAttemptCount: record.analysisAttemptCount ?? 0,
    analysisError: record.analysisError ?? null,
    active: isActiveAnalysisStatus(analysisStatus),
    token: createAnalysisStatusToken({
      analysisStatus,
      analysisRequestedAt: record.analysisRequestedAt ?? null,
      analysisCompletedAt: record.analysisCompletedAt ?? null,
      analysisProcessedFiles: record.analysisProcessedFiles ?? null,
      analysisTotalFiles: record.analysisTotalFiles ?? null,
      analysisAttemptCount: record.analysisAttemptCount ?? 0,
      analysisError: record.analysisError ?? null,
    }),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
