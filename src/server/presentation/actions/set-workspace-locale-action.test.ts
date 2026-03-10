import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  setCookieMock,
  cookiesMock,
  revalidatePathMock,
  redirectMock,
} = vi.hoisted(() => {
  const setCookieMock = vi.fn();
  return {
    setCookieMock,
    cookiesMock: vi.fn(async () => ({ set: setCookieMock })),
    revalidatePathMock: vi.fn(),
    redirectMock: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { setWorkspaceLocaleAction } from "@/server/presentation/actions/set-workspace-locale-action";

describe("setWorkspaceLocaleAction", () => {
  beforeEach(() => {
    setCookieMock.mockClear();
    cookiesMock.mockClear();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
  });

  it("persists locale cookie and redirects to current review", async () => {
    const formData = new FormData();
    formData.set("reviewId", "review-1");
    formData.set("locale", "ja");

    await setWorkspaceLocaleAction(formData);

    expect(cookiesMock).toHaveBeenCalledTimes(1);
    expect(setCookieMock).toHaveBeenCalledWith("locus-ui-locale", "ja", {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/reviews/review-1");
    expect(redirectMock).toHaveBeenCalledWith("/reviews/review-1");
  });

  it("rejects unsupported locale values", async () => {
    const formData = new FormData();
    formData.set("reviewId", "review-2");
    formData.set("locale", "de");

    await expect(setWorkspaceLocaleAction(formData)).rejects.toThrow(
      "Unsupported workspace locale: de",
    );
    expect(setCookieMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
