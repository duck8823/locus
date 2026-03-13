import { describe, expect, it } from "vitest";
import {
  readPersistedManualOpen,
  resolveCollapsibleOpenState,
  resolveManualOpenOnToggle,
  writePersistedManualOpen,
} from "./collapsible-details";

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

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.get(key) ?? null;
    },
    key(index) {
      const keys = [...map.keys()];
      return keys[index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  };
}

describe("readPersistedManualOpen", () => {
  it("returns null when key or storage is unavailable", () => {
    expect(readPersistedManualOpen({ storage: null, storageKey: "panel" })).toBeNull();
    expect(readPersistedManualOpen({ storage: createMemoryStorage(), storageKey: null })).toBeNull();
  });

  it("reads open/closed states from storage", () => {
    const storage = createMemoryStorage();
    storage.setItem("locus-collapsible:panel-1", "open");
    storage.setItem("locus-collapsible:panel-2", "closed");

    expect(readPersistedManualOpen({ storage, storageKey: "panel-1" })).toBe(true);
    expect(readPersistedManualOpen({ storage, storageKey: "panel-2" })).toBe(false);
    expect(readPersistedManualOpen({ storage, storageKey: "panel-3" })).toBeNull();
  });
});

describe("writePersistedManualOpen", () => {
  it("writes open/closed values and removes record for null", () => {
    const storage = createMemoryStorage();

    writePersistedManualOpen({
      storage,
      storageKey: "panel",
      manualOpen: true,
    });
    expect(storage.getItem("locus-collapsible:panel")).toBe("open");

    writePersistedManualOpen({
      storage,
      storageKey: "panel",
      manualOpen: false,
    });
    expect(storage.getItem("locus-collapsible:panel")).toBe("closed");

    writePersistedManualOpen({
      storage,
      storageKey: "panel",
      manualOpen: null,
    });
    expect(storage.getItem("locus-collapsible:panel")).toBeNull();
  });
});
