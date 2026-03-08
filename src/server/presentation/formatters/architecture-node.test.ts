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
});
