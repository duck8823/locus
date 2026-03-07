import { NextResponse } from "next/server";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { MarkReviewGroupStatusUseCase } from "@/server/application/usecases/mark-review-group-status";
import { getDependencies } from "@/server/composition/dependencies";
import { parseProgressRequest } from "@/server/presentation/api/parse-progress-request";
import { isReviewGroupNotFoundError } from "@/server/presentation/errors/is-review-group-not-found-error";
import { toReviewWorkspaceDto } from "@/server/presentation/mappers/to-review-workspace-dto";

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  try {
    const { reviewId } = await context.params;
    const body = await request.json().catch(() => null);
    const { groupId, status } = parseProgressRequest(body);
    const { reviewSessionRepository } = getDependencies();
    const useCase = new MarkReviewGroupStatusUseCase({ reviewSessionRepository });
    const reviewSession = await useCase.execute({ reviewId, groupId, status });

    return NextResponse.json(
      {
        reviewId,
        groupId,
        status,
        workspace: toReviewWorkspaceDto(reviewSession),
      },
      { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error instanceof ReviewSessionNotFoundError || isReviewGroupNotFoundError(error))
    ) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
