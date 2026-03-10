import { describe, expect, it } from "vitest";
import { resolveWorkspaceLocaleFromCookieString } from "./workspace-locale-client";

describe("workspace-locale-client", () => {
  it("returns japanese when locale cookie is ja", () => {
    expect(resolveWorkspaceLocaleFromCookieString("foo=1; locus-ui-locale=ja; bar=2")).toBe(
      "ja",
    );
  });

  it("returns english for unsupported locale cookies", () => {
    expect(resolveWorkspaceLocaleFromCookieString("locus-ui-locale=fr")).toBe("en");
  });

  it("returns english when cookie header is missing", () => {
    expect(resolveWorkspaceLocaleFromCookieString(null)).toBe("en");
  });
});
