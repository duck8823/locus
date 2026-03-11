import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  getDependenciesMock,
  revalidatePathMock,
  redirectMock,
} = vi.hoisted(() => ({
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

vi.mock("@/server/application/usecases/set-connection-state", () => ({
  SetConnectionStateUseCase: class {
    async execute(input: {
      reviewerId: string;
      provider: string;
      nextStatus: string;
      connectedAccountLabel: string | null;
    }) {
      return executeMock(input);
    }
  },
}));

import { setConnectionStateAction } from "@/server/presentation/actions/set-connection-state-action";

describe("setConnectionStateAction", () => {
  beforeEach(() => {
    executeMock.mockReset();
    getDependenciesMock.mockReset();
    revalidatePathMock.mockReset();
    redirectMock.mockReset();
    getDependenciesMock.mockReturnValue({
      connectionStateRepository: {},
      connectionStateTransitionRepository: {},
      connectionProviderCatalog: {},
    });
  });

  it("applies transition and redirects to settings page", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "demo-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("connectedAccountLabel", "duck8823");
    formData.set("redirectPath", "/settings/connections");

    await setConnectionStateAction(formData);

    expect(executeMock).toHaveBeenCalledWith({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "connected",
      connectedAccountLabel: "duck8823",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings/connections");
    expect(redirectMock).toHaveBeenCalledWith("/settings/connections");
  });

  it("normalizes blank account labels to null", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "demo-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "reauth_required");
    formData.set("connectedAccountLabel", " ");
    formData.set("redirectPath", "/settings/connections");

    await setConnectionStateAction(formData);

    expect(executeMock).toHaveBeenCalledWith({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "reauth_required",
      connectedAccountLabel: null,
    });
  });


  it("rejects overly long account labels", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "demo-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("connectedAccountLabel", "a".repeat(201));
    formData.set("redirectPath", "/settings/connections");

    await expect(setConnectionStateAction(formData)).rejects.toThrow(
      "connectedAccountLabel must be at most 200 characters",
    );
    expect(executeMock).not.toHaveBeenCalled();
  });
  it("rejects unsupported statuses", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "demo-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "planned");
    formData.set("redirectPath", "/settings/connections");

    await expect(setConnectionStateAction(formData)).rejects.toThrow(
      "Unsupported writable connection status: planned",
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects non-relative redirect path", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "demo-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("redirectPath", "https://example.com");

    await expect(setConnectionStateAction(formData)).rejects.toThrow(
      "Invalid redirectPath: https://example.com",
    );
    expect(executeMock).not.toHaveBeenCalled();
  });
});
