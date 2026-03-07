import { describe, expect, it } from "vitest";

import { diffSources, formatChanges } from "../src/index.js";

describe("diffSources", () => {
  it("ignores whitespace-only and comment-only changes", () => {
    const before = `
      export function sum(a: number, b: number) {
        return a + b;
      }
    `;

    const after = `
      export function sum(a: number, b: number) {
        // keep this compact
        return a + b;
      }
    `;

    expect(diffSources(before, after)).toEqual([]);
  });

  it("detects method body changes independently from signature changes", () => {
    const before = `
      export class UserService {
        updateProfile(user: User) {
          validateEmail(user.email);
        }
      }
    `;

    const after = `
      export class UserService {
        updateProfile(user: User) {
          validateEmail(user.email);
          validatePhone(user.phone);
        }
      }
    `;

    expect(diffSources(before, after)).toEqual([
      expect.objectContaining({
        id: "UserService.updateProfile",
        changeType: "modified",
        signatureChanged: false,
        bodyChanged: true,
      }),
    ]);
  });

  it("detects signature changes for function-valued variables", () => {
    const before = `
      export const normalize = (input: string) => input.trim();
    `;

    const after = `
      export const normalize = (input: string, locale = "ja") => input.trim();
    `;

    expect(diffSources(before, after)).toEqual([
      expect.objectContaining({
        id: "normalize",
        changeType: "modified",
        signatureChanged: true,
        bodyChanged: false,
      }),
    ]);
  });

  it("reports added and removed callables", () => {
    const before = `
      export function legacyNormalize(input: string) {
        return input;
      }
    `;

    const after = `
      export function normalize(input: string) {
        return input.trim();
      }
    `;

    expect(diffSources(before, after)).toEqual([
      expect.objectContaining({
        id: "legacyNormalize",
        changeType: "removed",
      }),
      expect.objectContaining({
        id: "normalize",
        changeType: "added",
      }),
    ]);
  });
});

describe("formatChanges", () => {
  it("renders a stable human-readable summary", () => {
    const output = formatChanges([
      {
        id: "UserService.updateProfile",
        name: "UserService.updateProfile",
        kind: "class-method",
        changeType: "modified",
        signatureChanged: false,
        bodyChanged: true,
        afterLocation: {
          filePath: "/tmp/after.ts",
          startLine: 3,
          endLine: 6,
        },
      },
    ]);

    expect(output).toContain("Detected 1 semantic change.");
    expect(output).toContain("~ class-method UserService.updateProfile [body] (after.ts:3)");
  });
});
