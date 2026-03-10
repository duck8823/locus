import { NextResponse } from "next/server";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { MarkReviewGroupStatusUseCase } from "@/server/application/usecases/mark-review-group-status";
import { getDependencies } from "@/server/composition/dependencies";
import { createApiErrorResponse } from "@/server/presentation/api/api-error-response";
import { parseProgressRequest } from "@/server/presentation/api/parse-progress-request";
import { ReviewGroupNotFoundError } from "@/server/presentation/errors/review-group-not-found-error";
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
    if (error instanceof ReviewSessionNotFoundError) {
      return createApiErrorResponse({
        status: 404,
        code: "REVIEW_SESSION_NOT_FOUND",
        message: error.message,
      });
    }

    if (error instanceof ReviewGroupNotFoundError) {
      return createApiErrorResponse({
        status: 404,
        code: "REVIEW_GROUP_NOT_FOUND",
        message: error.message,
      });
    }

    if (error instanceof Error) {
      return createApiErrorResponse({
        status: 400,
        code: "INVALID_PROGRESS_REQUEST",
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
