import { NextResponse } from "next/server";
import { AcceptGitHubWebhookUseCase } from "@/server/application/usecases/accept-github-webhook";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import { getDependencies } from "@/server/composition/dependencies";
import { createApiErrorResponse } from "@/server/presentation/api/api-error-response";
import {
  GitHubWebhookRequestError,
  parseGitHubWebhookRequest,
} from "@/server/presentation/api/parse-github-webhook-request";

export async function POST(request: Request) {
  try {
    const parsed = await parseGitHubWebhookRequest(request);
    const {
      analysisJobScheduler,
      reviewSessionRepository,
      connectionStateTransitionRepository,
      connectionProviderCatalog,
    } = getDependencies();
    const useCase = new AcceptGitHubWebhookUseCase({ analysisJobScheduler });
    const result = await useCase.execute({
      reviewId: parsed.reviewId,
      eventName: parsed.eventName,
      deliveryId: parsed.deliveryId,
    });
    try {
      const reviewSession = await reviewSessionRepository.findByReviewId(parsed.reviewId);

      if (reviewSession) {
        const source = reviewSession.toRecord().source;

        if (source?.provider === "github") {
          const setConnectionStateUseCase = new SetConnectionStateUseCase({
            connectionStateTransitionRepository,
            connectionProviderCatalog,
          });

          await setConnectionStateUseCase.execute({
            reviewerId: reviewSession.viewerName,
            provider: "github",
            nextStatus: "connected",
            connectedAccountLabel: null,
            transitionReason: "webhook",
            transitionActorType: "system",
            transitionActorId: `github-webhook:${parsed.deliveryId}`,
          });
        }
      }
    } catch {
      // Connection-state sync failure must not reject webhook ingestion.
    }

    return NextResponse.json(
      {
        accepted: true,
        reviewId: parsed.reviewId,
        eventName: result.eventName,
        deliveryId: result.deliveryId,
        jobId: result.scheduledJob.jobId,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof GitHubWebhookRequestError) {
      return createApiErrorResponse({
        status: error.statusCode,
        code: "GITHUB_WEBHOOK_REQUEST_INVALID",
        message: error.message,
      });
    }

    if (error instanceof Error) {
      return createApiErrorResponse({
        status: 400,
        code: "INVALID_WEBHOOK_REQUEST",
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
