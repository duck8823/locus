import { describe, expect, it } from "vitest";
import {
  readWorkspaceLocaleFromCookieString,
  resolveWorkspaceLocaleFromCookieString,
} from "./workspace-locale-client";

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

  it("returns english when locale cookie has malformed URI encoding", () => {
    expect(
      resolveWorkspaceLocaleFromCookieString("locus-ui-locale=%E0%A4%A"),
    ).toBe("en");
  });

  it("returns null from raw cookie reader when locale cookie is absent", () => {
    expect(readWorkspaceLocaleFromCookieString("foo=1; bar=2")).toBeNull();
  });
});
