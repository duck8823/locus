import { describe, expect, it } from "vitest";
import { resolveWorkspaceLocale } from "./workspace-locale";

describe("workspace-locale", () => {
  it("prefers explicit locale cookie over accept-language", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: "ja-JP",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("ja");
  });

  it("falls back to accept-language when preferred locale is missing", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,ja;q=0.9,en;q=0.8",
      }),
    ).toBe("ja");
  });

  it("respects q-values when selecting supported locale from accept-language", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: null,
        acceptLanguage: "en;q=0.1, ja;q=0.9",
      }),
    ).toBe("ja");
  });

  it("falls back to english when no supported locale is provided", () => {
    expect(
      resolveWorkspaceLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,de-DE",
      }),
    ).toBe("en");
  });
});
