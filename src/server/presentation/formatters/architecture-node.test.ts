import { describe, expect, it } from "vitest";
import {
  groupArchitectureNodes,
  toArchitectureNodeView,
} from "@/server/presentation/formatters/architecture-node";

describe("architecture-node formatter", () => {
  it("parses known node prefixes into readable labels", () => {
    expect(toArchitectureNodeView("layer:domain")).toEqual({
      raw: "layer:domain",
      kind: "layer",
      label: "domain",
    });
    expect(toArchitectureNodeView("file:src/domain/user-service.ts")).toEqual({
      raw: "file:src/domain/user-service.ts",
      kind: "file",
      label: "src/domain/user-service.ts",
    });
    expect(toArchitectureNodeView("symbol:function::<root>::createUser")).toEqual({
      raw: "symbol:function::<root>::createUser",
      kind: "symbol",
      label: "createUser (function)",
    });
  });

  it("includes symbol container names in labels", () => {
    expect(toArchitectureNodeView("symbol:method:UserService::save")).toEqual({
      raw: "symbol:method:UserService::save",
      kind: "symbol",
      label: "UserService.save (method)",
    });
  });

  it("groups and deduplicates architecture nodes", () => {
    const grouped = groupArchitectureNodes([
      "layer:domain",
      "layer:domain",
      "file:src/domain/user-service.ts",
      "symbol:function::<root>::createUser",
      "unknown:raw",
    ]);

    expect(grouped.layer).toHaveLength(1);
    expect(grouped.file).toHaveLength(1);
    expect(grouped.symbol).toHaveLength(1);
    expect(grouped.unknown).toHaveLength(1);
  });

  it("handles empty and unknown node payloads safely", () => {
    expect(toArchitectureNodeView("layer:")).toEqual({
      raw: "layer:",
      kind: "layer",
      label: "unknown",
    });
    expect(toArchitectureNodeView("file:")).toEqual({
      raw: "file:",
      kind: "file",
      label: "unknown",
    });
    expect(toArchitectureNodeView("symbol:")).toEqual({
      raw: "symbol:",
      kind: "symbol",
      label: "unknown symbol",
    });
    expect(toArchitectureNodeView("module:foo")).toEqual({
      raw: "module:foo",
      kind: "unknown",
      label: "module:foo",
    });
  });

  it("sorts grouped labels alphabetically", () => {
    const grouped = groupArchitectureNodes([
      "file:src/z.ts",
      "file:src/a.ts",
      "file:src/m.ts",
    ]);

    expect(grouped.file.map((node) => node.label)).toEqual([
      "src/a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
  });

  it("formats symbol-only payloads without duplicated kind labels", () => {
    expect(toArchitectureNodeView("symbol:method")).toEqual({
      raw: "symbol:method",
      kind: "symbol",
      label: "method symbol",
    });
  });
});
