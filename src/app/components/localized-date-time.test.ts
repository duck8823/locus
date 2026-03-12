import { describe, expect, it } from "vitest";
import { resolveLocalizedDateTimeLocale } from "./localized-date-time";

describe("resolveLocalizedDateTimeLocale", () => {
  it("maps workspace locale to Intl locale tags", () => {
    expect(resolveLocalizedDateTimeLocale("ja")).toBe("ja-JP");
    expect(resolveLocalizedDateTimeLocale("en")).toBe("en-US");
  });

  it("falls back to runtime locale when locale is undefined", () => {
    expect(resolveLocalizedDateTimeLocale(undefined)).toBeUndefined();
  });
});
