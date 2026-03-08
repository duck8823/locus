import { NextResponse } from "next/server";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { getDependencies } from "@/server/composition/dependencies";
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
        lastReanalyzeRequestedAt: result.reviewSession.toRecord().lastReanalyzeRequestedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ReviewSessionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
