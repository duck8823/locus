import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";

const { executeMock, getDependenciesMock, revalidatePathMock, redirectMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getDependenciesMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/request-manual-reanalysis", () => ({
  RequestManualReanalysisUseCase: class {
    async execute(input: { reviewId: string }) {
      return executeMock(input);
    }
  },
}));

import { requestReanalysisAction } from "@/server/presentation/actions/request-reanalysis-action";

describe("requestReanalysisAction", () => {
  beforeEach(() => {
    executeMock.mockReset();
    getDependenciesMock.mockReset();
    revalidatePathMock.mockReset();
    redirectMock.mockReset();
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
    });
  });

  it("revalidates and redirects on success", async () => {
    const formData = new FormData();
    formData.set("reviewId", "review-1");

    await requestReanalysisAction(formData);

    expect(executeMock).toHaveBeenCalledWith({ reviewId: "review-1" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/reviews/review-1");
    expect(redirectMock).toHaveBeenCalledWith("/reviews/review-1");
  });

  it("redirects with workspace_not_found when review is missing", async () => {
    executeMock.mockRejectedValueOnce(new ReviewSessionNotFoundError("review-1"));
    const formData = new FormData();
    formData.set("reviewId", "review-1");

    await requestReanalysisAction(formData);

    expect(redirectMock).toHaveBeenCalledWith(
      "/reviews/review-1?workspaceError=workspace_not_found",
    );
  });
});
