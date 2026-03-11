import { describe, expect, it } from "vitest";
import { GetConnectionsWorkspaceUseCase } from "@/server/application/usecases/get-connections-workspace";

describe("GetConnectionsWorkspaceUseCase", () => {
  it("returns prototype connection catalog entries", async () => {
    const useCase = new GetConnectionsWorkspaceUseCase();

    const result = await useCase.execute();

    expect(result.connections).toEqual([
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
  });
});
