export class ReviewGroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Review group not found: ${groupId}`);
    this.name = "ReviewGroupNotFoundError";
  }
}
