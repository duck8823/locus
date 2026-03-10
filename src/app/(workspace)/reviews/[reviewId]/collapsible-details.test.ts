import { describe, expect, it } from "vitest";
import { resolveCollapsibleOpenState } from "./collapsible-details";

describe("resolveCollapsibleOpenState", () => {
  it("uses defaultOpen before user toggles", () => {
    expect(
      resolveCollapsibleOpenState({ manualOpen: null, defaultOpen: true }),
    ).toBe(true);
    expect(
      resolveCollapsibleOpenState({ manualOpen: null, defaultOpen: false }),
    ).toBe(false);
  });

  it("prioritizes user-opened state", () => {
    expect(
      resolveCollapsibleOpenState({ manualOpen: true, defaultOpen: false }),
    ).toBe(true);
  });

  it("prioritizes user-closed state", () => {
    expect(
      resolveCollapsibleOpenState({ manualOpen: false, defaultOpen: true }),
    ).toBe(false);
  });
});
