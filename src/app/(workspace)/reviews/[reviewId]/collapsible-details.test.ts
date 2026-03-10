import { describe, expect, it } from "vitest";
import { resolveCollapsibleOpenState, resolveManualOpenOnToggle } from "./collapsible-details";

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

describe("resolveManualOpenOnToggle", () => {
  it("keeps previous manual state when toggle is not user-initiated", () => {
    expect(
      resolveManualOpenOnToggle({
        hasManualToggleIntent: false,
        nextOpen: true,
        previousManualOpen: null,
      }),
    ).toBeNull();
    expect(
      resolveManualOpenOnToggle({
        hasManualToggleIntent: false,
        nextOpen: false,
        previousManualOpen: true,
      }),
    ).toBe(true);
  });

  it("captures the latest state when toggle is user-initiated", () => {
    expect(
      resolveManualOpenOnToggle({
        hasManualToggleIntent: true,
        nextOpen: true,
        previousManualOpen: null,
      }),
    ).toBe(true);
    expect(
      resolveManualOpenOnToggle({
        hasManualToggleIntent: true,
        nextOpen: false,
        previousManualOpen: true,
      }),
    ).toBe(false);
  });
});
