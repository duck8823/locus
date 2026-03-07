import { NextResponse } from "next/server";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { ReviewSessionNotFoundError } from "@/server/application/usecases/mark-review-group-status";
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
    const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository,
      analysisJobScheduler,
    });
    const result = await useCase.execute({ reviewId });

    return NextResponse.json(
      {
        reviewId,
        jobId: result.scheduledJob.jobId,
        acceptedAt: result.scheduledJob.acceptedAt,
      },
      { status: 202 },
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
