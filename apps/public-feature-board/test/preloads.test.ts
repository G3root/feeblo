import { DbClient } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
  isBoardPreloadDegraded,
} from "../src/lib/board-scope";
import {
  preloadBoardShell,
  preloadChangelogDetail,
  preloadPostDetail,
} from "../src/lib/preloads";

function createClient(scope: ReturnType<typeof createBoardScope>) {
  return new DbClient({
    [BOARD_QUERY_CLIENT_DEPENDENCY]: new QueryClient(),
    [BOARD_SCOPE_DEPENDENCY]: scope,
  });
}

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

/**
 * A child route's `beforeLoad` runs before the layout's render on a fresh
 * document, and every collection query key embeds the scope's organization id.
 * A preload that materializes a collection before that id is published keys
 * its on-demand subsets without it; the later unload then recomputes the
 * component's key and can delete rows the page is rendering.
 */
describe("preload scope", () => {
  it("publishes the organization before the post preloads materialize", () => {
    const scope = createBoardScope({ pathname: () => "/p/some-slug" });
    const client = createClient(scope);

    expect(scope.getOrganizationId()).toBeUndefined();

    void preloadPostDetail(client, {
      organizationId: "org_1",
      slug: "some-slug",
    }).catch(() => undefined);

    expect(scope.getOrganizationId()).toBe("org_1");
  });

  it("publishes the organization before the changelog preloads materialize", () => {
    const scope = createBoardScope({ pathname: () => "/changelog/some-slug" });
    const client = createClient(scope);

    expect(scope.getOrganizationId()).toBeUndefined();

    void preloadChangelogDetail(client, {
      organizationId: "org_1",
      slug: "some-slug",
    }).catch(() => undefined);

    expect(scope.getOrganizationId()).toBe("org_1");
  });
});
