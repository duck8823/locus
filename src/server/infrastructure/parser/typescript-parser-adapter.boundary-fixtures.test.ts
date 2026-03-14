import { describe, expect, it } from "vitest";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

function createSnapshot(overrides: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    snapshotId: "snapshot",
    fileId: "file",
    filePath: "src/demo.ts",
    language: "typescript",
    revision: "before",
    content: "export function demo() { return 1; }",
    metadata: {
      codeHost: "github",
    },
    ...overrides,
  };
}

function createLargeBoundaryContent(input: { fillerLines: number; returnOffset: number }): string {
  const filler = Array.from({ length: input.fillerLines }, (_, index) => `// filler ${index + 1}`).join("\n");

  return `
${filler}

export function tailCallable(value: number): number {
  return value + ${input.returnOffset};
}
`.trim();
}

describe("TypeScriptParserAdapter boundary fixtures", () => {
  it("treats callable rename as a removed+added pair", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export function normalizePhone(input: string): string {
  return input.trim();
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export function normalizeContactPhone(input: string): string {
  return input.trim();
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(
      diff.items.map((item) => ({
        symbolKey: item.symbolKey,
        changeType: item.changeType,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          symbolKey: "function::<root>::normalizePhone",
          changeType: "removed",
        },
        {
          symbolKey: "function::<root>::normalizeContactPhone",
          changeType: "added",
        },
      ]),
    );
  });

  it("detects signature-only updates on callable class properties with mixed modifiers", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: `
export class AccessController {
  public readonly validate = async (token: string): Promise<boolean> => {
    return token.length > 0;
  };
}
`.trim(),
    });
    const after = createSnapshot({
      revision: "after",
      content: `
export class AccessController {
  protected readonly validate = async (token: string): Promise<boolean> => {
    return token.length > 0;
  };
}
`.trim(),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]).toMatchObject({
      symbolKey: "method::AccessController::instance::validate",
      changeType: "modified",
      bodySummary: "Signature changed",
    });
  });

  it("keeps high line-number regions stable near large-file boundaries", async () => {
    const adapter = new TypeScriptParserAdapter();
    const before = createSnapshot({
      revision: "before",
      content: createLargeBoundaryContent({
        fillerLines: 1_500,
        returnOffset: 1,
      }),
    });
    const after = createSnapshot({
      revision: "after",
      content: createLargeBoundaryContent({
        fillerLines: 1_500,
        returnOffset: 2,
      }),
    });

    const diff = await adapter.diff({
      before: await adapter.parse(before),
      after: await adapter.parse(after),
    });
    const [change] = diff.items;

    expect(diff.items).toHaveLength(1);
    expect(change?.symbolKey).toBe("function::<root>::tailCallable");
    expect(change?.changeType).toBe("modified");
    expect(change?.beforeRegion?.startLine).toBeGreaterThan(1_400);
    expect(change?.afterRegion?.startLine).toBe(change?.beforeRegion?.startLine);
  });
});
