import { ReviewGroupNotFoundError } from "@/server/domain/errors/review-group-not-found-error";

export function isReviewGroupNotFoundError(error: unknown): error is ReviewGroupNotFoundError {
  return error instanceof ReviewGroupNotFoundError;
}
