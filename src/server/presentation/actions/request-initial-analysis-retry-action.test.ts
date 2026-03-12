import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";

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

vi.mock("@/server/application/usecases/request-initial-analysis-retry", () => ({
  RequestInitialAnalysisRetryUseCase: class {
    async execute(input: { reviewId: string }) {
      return executeMock(input);
    }
  },
}));

import { requestInitialAnalysisRetryAction } from "@/server/presentation/actions/request-initial-analysis-retry-action";

describe("requestInitialAnalysisRetryAction", () => {
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

    await requestInitialAnalysisRetryAction(formData);

    expect(executeMock).toHaveBeenCalledWith({ reviewId: "review-1" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/reviews/review-1");
    expect(redirectMock).toHaveBeenCalledWith("/reviews/review-1");
  });

  it("redirects with normalized workspace error code on failure", async () => {
    executeMock.mockRejectedValueOnce(new ReanalyzeSourceUnavailableError("review-1"));
    const formData = new FormData();
    formData.set("reviewId", "review-1");

    await requestInitialAnalysisRetryAction(formData);

    expect(redirectMock).toHaveBeenCalledWith(
      "/reviews/review-1?workspaceError=source_unavailable",
    );
  });
});
