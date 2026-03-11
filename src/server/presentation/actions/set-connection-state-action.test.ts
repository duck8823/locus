import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  cookiesMock,
  getDependenciesMock,
  revalidatePathMock,
  redirectMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  cookiesMock: vi.fn(),
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

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
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
      transitionReason: "manual";
      transitionActorType: "reviewer";
      transitionActorId: string;
    }) {
      return executeMock(input);
    }
  },
}));

import { setConnectionStateAction } from "@/server/presentation/actions/set-connection-state-action";

describe("setConnectionStateAction", () => {
  beforeEach(() => {
    executeMock.mockReset();
    cookiesMock.mockReset();
    getDependenciesMock.mockReset();
    revalidatePathMock.mockReset();
    redirectMock.mockReset();
    getDependenciesMock.mockReturnValue({
      connectionStateRepository: {},
      connectionStateTransitionRepository: {},
      connectionProviderCatalog: {},
    });
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "locus-demo-viewer" ? { value: "cookie-reviewer" } : undefined,
      ),
    });
  });

  it("applies transition and redirects to settings page", async () => {
    const formData = new FormData();
    formData.set("reviewerId", "tampered-reviewer");
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("connectedAccountLabel", "duck8823");
    formData.set("redirectPath", "/settings/connections");

    await setConnectionStateAction(formData);

    expect(executeMock).toHaveBeenCalledWith({
      reviewerId: "cookie-reviewer",
      provider: "github",
      nextStatus: "connected",
      connectedAccountLabel: "duck8823",
      transitionReason: "manual",
      transitionActorType: "reviewer",
      transitionActorId: "cookie-reviewer",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings/connections");
    expect(redirectMock).toHaveBeenCalledWith("/settings/connections");
  });

  it("normalizes blank account labels to null", async () => {
    const formData = new FormData();
    formData.set("provider", "github");
    formData.set("nextStatus", "reauth_required");
    formData.set("connectedAccountLabel", " ");
    formData.set("redirectPath", "/settings/connections");

    await setConnectionStateAction(formData);

    expect(executeMock).toHaveBeenCalledWith({
      reviewerId: "cookie-reviewer",
      provider: "github",
      nextStatus: "reauth_required",
      connectedAccountLabel: null,
      transitionReason: "manual",
      transitionActorType: "reviewer",
      transitionActorId: "cookie-reviewer",
    });
  });


  it("rejects overly long account labels", async () => {
    const formData = new FormData();
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
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("redirectPath", "https://example.com");

    await expect(setConnectionStateAction(formData)).rejects.toThrow(
      "Invalid redirectPath: https://example.com",
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("falls back to anonymous reviewer when demo cookie is missing", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => undefined),
    });
    const formData = new FormData();
    formData.set("provider", "github");
    formData.set("nextStatus", "connected");
    formData.set("redirectPath", "/settings/connections");

    await setConnectionStateAction(formData);

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerId: "anonymous",
      }),
    );
  });
});
