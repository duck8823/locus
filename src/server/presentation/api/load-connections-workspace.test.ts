import { describe, expect, it } from "vitest";
import { loadConnectionsWorkspaceDto } from "@/server/presentation/api/load-connections-workspace";

describe("loadConnectionsWorkspaceDto", () => {
  it("returns connection dto payload with generated timestamp", async () => {
    const dto = await loadConnectionsWorkspaceDto();

    expect(dto.connections).toEqual([
      {
        provider: "github",
        status: "not_connected",
        authMode: "oauth",
      },
      {
        provider: "confluence",
        status: "planned",
        authMode: "oauth",
      },
      {
        provider: "jira",
        status: "planned",
        authMode: "oauth",
      },
    ]);
    expect(Number.isNaN(Date.parse(dto.generatedAt))).toBe(false);
  });
});
