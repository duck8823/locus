import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import { toReviewWorkspaceDto } from "@/server/presentation/mappers/to-review-workspace-dto";
import type { ReviewWorkspaceDto } from "@/server/presentation/dto/review-workspace-dto";

export interface LoadReviewWorkspaceInput {
  reviewId: string;
}

export async function loadReviewWorkspaceDto({ reviewId }: LoadReviewWorkspaceInput): Promise<ReviewWorkspaceDto> {
  const { reviewSessionRepository } = getDependencies();
  const useCase = new GetReviewWorkspaceUseCase({ reviewSessionRepository });
  const reviewSession = await useCase.execute({ reviewId });

  return toReviewWorkspaceDto(reviewSession);
}
