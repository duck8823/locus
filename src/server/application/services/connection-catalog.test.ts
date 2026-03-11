import { describe, expect, it } from "vitest";
import { listPrototypeConnectionCatalog } from "@/server/application/services/connection-catalog";

describe("listPrototypeConnectionCatalog", () => {
  it("returns deep-cloned capabilities so mutations do not leak across calls", () => {
    const first = listPrototypeConnectionCatalog();
    first[0].capabilities.supportsWebhook = false;
    first[0].capabilities.supportsIssueContext = false;

    const second = listPrototypeConnectionCatalog();

    expect(second[0].capabilities).toEqual({
      supportsWebhook: true,
      supportsIssueContext: true,
    });
  });
});
