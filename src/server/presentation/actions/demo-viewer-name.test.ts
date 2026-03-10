import { describe, expect, it } from "vitest";
import { resolveDemoViewerLocale, resolveDemoViewerName } from "./demo-viewer-name";

describe("resolveDemoViewerLocale", () => {
  it("prefers explicit locale cookie", () => {
    expect(
      resolveDemoViewerLocale({
        preferredLocale: "ja",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("ja");
  });

  it("falls back to accept-language when cookie is missing", () => {
    expect(
      resolveDemoViewerLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,ja;q=0.8,en;q=0.7",
      }),
    ).toBe("ja");
  });

  it("respects q-values in accept-language", () => {
    expect(
      resolveDemoViewerLocale({
        preferredLocale: null,
        acceptLanguage: "ja;q=0.4,en;q=0.9",
      }),
    ).toBe("en");
  });

  it("falls back to english when no supported locales are present", () => {
    expect(
      resolveDemoViewerLocale({
        preferredLocale: null,
        acceptLanguage: "fr-FR,de-DE",
      }),
    ).toBe("en");
  });
});

describe("resolveDemoViewerName", () => {
  it("returns japanese reviewer name for japanese locale", () => {
    expect(
      resolveDemoViewerName({
        preferredLocale: "ja-JP",
      }),
    ).toBe("デモレビュアー");
  });

  it("returns english reviewer name for non-japanese locales", () => {
    expect(
      resolveDemoViewerName({
        preferredLocale: "en-US",
      }),
    ).toBe("Demo reviewer");
  });
});
