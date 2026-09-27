import { DbClient } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
} from "../src/lib/board-scope";
import { applyPublicCollectionIndexes } from "../src/lib/collections";

/**
 * Per-client materialization of the board's descriptors.
 *
 * The SSR path builds one of these per request and preloads it; the browser
 * builds one per document. This covers the wiring that fails loudly in a
 * Worker: descriptor ids, injected dependencies, and the join indexes.
 */
function createClient(organizationId: string): DbClient {
  return new DbClient({
    [BOARD_QUERY_CLIENT_DEPENDENCY]: new QueryClient(),
    [BOARD_SCOPE_DEPENDENCY]: createBoardScope({
      organizationId,
      pathname: () => "/",
    }),
  });
}

describe("applyPublicCollectionIndexes", () => {
  it("materializes every descriptor on the client without fetching", () => {
    const client = createClient("org_1");

    expect(() => applyPublicCollectionIndexes(client)).not.toThrow();
  });

  it("is idempotent: a client's collections are indexed once", () => {
    const client = createClient("org_1");

    applyPublicCollectionIndexes(client);

    expect(() => applyPublicCollectionIndexes(client)).not.toThrow();
  });

  it("scopes each client's collections to its own board", () => {
    const first = createClient("org_a");
    const second = createClient("org_b");

    applyPublicCollectionIndexes(first);
    applyPublicCollectionIndexes(second);

    expect(
      first
        .requireDependency<ReturnType<typeof createBoardScope>>(
          BOARD_SCOPE_DEPENDENCY
        )
        .getOrganizationId()
    ).toBe("org_a");
    expect(
      second
        .requireDependency<ReturnType<typeof createBoardScope>>(
          BOARD_SCOPE_DEPENDENCY
        )
        .getOrganizationId()
    ).toBe("org_b");
  });
});
