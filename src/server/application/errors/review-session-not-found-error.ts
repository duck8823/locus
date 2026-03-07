export class ReviewSessionNotFoundError extends Error {
  constructor(reviewId: string) {
    super(`Review session not found: ${reviewId}`);
    this.name = "ReviewSessionNotFoundError";
  }
}
