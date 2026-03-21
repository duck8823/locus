export class ReviewSessionAccessDeniedError extends Error {
  constructor(reviewId: string) {
    super(`Access denied to review session: ${reviewId}`);
    this.name = "ReviewSessionAccessDeniedError";
  }
}
