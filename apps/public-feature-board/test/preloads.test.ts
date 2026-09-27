import { DbClient } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
  isBoardPreloadDegraded,
} from "../src/lib/board-scope";
import { preloadBoardShell } from "../src/lib/preloads";

/**
 * A route's preloads report their outcome on the request's scope, because the
 * layout decides the document's cache and index policy *after* every match has
 * loaded — and a child route's preload can degrade after the layout's own hook
 * has returned.
 *
 * There is no API here, so every preload fails: the degraded path is the one
 * under test.
 */
describe("preload outcomes", () => {
  function createClient(scope: ReturnType<typeof createBoardScope>) {
    return new DbClient({
      [BOARD_QUERY_CLIENT_DEPENDENCY]: new QueryClient(),
      [BOARD_SCOPE_DEPENDENCY]: scope,
    });
  }

  it("marks the request when a preload cannot complete", async () => {
    const scope = createBoardScope({
      organizationId: "org_1",
      pathname: () => "/",
    });
    const client = createClient(scope);

    expect(isBoardPreloadDegraded(client)).toBe(false);

    const outcome = await preloadBoardShell(client);

    expect(outcome.degraded).toBe(true);
    expect(isBoardPreloadDegraded(client)).toBe(true);
  });

  it("leaves another request's scope alone", async () => {
    const failing = createBoardScope({
      organizationId: "org_1",
      pathname: () => "/",
    });
    const other = createBoardScope({
      organizationId: "org_2",
      pathname: () => "/",
    });

    await preloadBoardShell(createClient(failing));

    expect(isBoardPreloadDegraded(createClient(other))).toBe(false);
  });
});
