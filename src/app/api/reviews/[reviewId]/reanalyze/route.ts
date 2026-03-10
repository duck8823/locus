import { NextResponse } from "next/server";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { getDependencies } from "@/server/composition/dependencies";
import { createApiErrorResponse } from "@/server/presentation/api/api-error-response";
import { parseReanalyzeRequest } from "@/server/presentation/api/parse-reanalyze-request";

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  try {
    const { reviewId } = await context.params;
    const body = await request.json().catch(() => null);
    parseReanalyzeRequest(body);
    const { reviewSessionRepository, parserAdapters, pullRequestSnapshotProvider } = getDependencies();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository,
      parserAdapters,
      pullRequestSnapshotProvider,
    });
    const result = await useCase.execute({ reviewId });

    return NextResponse.json(
      {
        reviewId,
        snapshotPairCount: result.snapshotPairCount,
        source: result.source,
        reanalysisStatus: result.reanalysisStatus,
        lastReanalyzeRequestedAt: result.lastReanalyzeRequestedAt,
        lastReanalyzeCompletedAt: result.lastReanalyzeCompletedAt,
        errorMessage: result.errorMessage,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ReviewSessionNotFoundError) {
      return createApiErrorResponse({
        status: 404,
        code: "REVIEW_SESSION_NOT_FOUND",
        message: error.message,
      });
    }

    if (error instanceof Error) {
      return createApiErrorResponse({
        status: 400,
        code: "INVALID_REANALYZE_REQUEST",
        message: error.message,
      });
    }

    return createApiErrorResponse({
      status: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Unknown error",
    });
  }
}
