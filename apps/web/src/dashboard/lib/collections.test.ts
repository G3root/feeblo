import { DbClient } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboardCollections } from "./collections";

/**
 * The SSR bundle evaluates this module at Workers global scope, where
 * `crypto.randomUUID()` and `crypto.getRandomValues()` throw ("Disallowed
 * operation called within global scope") and take the isolate down with them.
 * `createCollection` reaches for a random UUID unless the config carries an
 * explicit `id`, so this test is the guard that keeps every collection named.
 *
 * It imports the app's real collections module, so the import is the test: it
 * pulls in TanStack DB, React, and the query client before it can assert
 * anything. That takes seconds on an idle machine and much longer while
 * `turbo run test` is starting nineteen other suites, so the default five-second
 * budget reported a busy laptop as a crypto regression. The assertion is about
 * module-scope behaviour, not speed.
 */
describe("dashboard collections module evaluation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "generates no random values at module scope",
    { timeout: 60_000 },
    async () => {
      const failRandomValue = () => {
        throw new Error("random value generated in global scope");
      };

      vi.stubGlobal("crypto", {
        getRandomValues: failRandomValue,
        randomUUID: failRandomValue,
      });

      await expect(import("./collections")).resolves.toBeDefined();
    }
  );
});

/**
 * Materialization, which is the whole reason `createDashboardCollections`
 * takes its client and scope instead of reading the app's React tree.
 *
 * Before this seam existed the descriptors could only be reached through the
 * module-level `dashboardCollections` accessor, whose client comes from the
 * router's context — so nothing could instantiate one, and the only test was
 * the import guard above.
 */
function createClient(): DbClient {
  return new DbClient({ queryClient: new QueryClient() });
}

const organizationScope = {
  organizationId: "org_a",
  postSlug: undefined,
};
const postScope = {
  organizationId: "org_a",
  postSlug: "dark-mode",
};

describe("createDashboardCollections", () => {
  it("materializes every collection without fetching", () => {
    const collections = createDashboardCollections({
      client: createClient(),
      scope: postScope,
    });

    expect(Object.keys(collections).length).toBeGreaterThan(30);
    for (const [name, collection] of Object.entries(collections)) {
      expect(collection.id, `${name} has no id`).toBeTruthy();
    }
  });

  it("keys organization-scoped collections by organization", () => {
    const collections = createDashboardCollections({
      client: createClient(),
      scope: organizationScope,
    });

    expect(collections.postCollection.id).toBe("postCollection:org_a");
    expect(collections.boardCollection.id).toBe("boardCollection:org_a");
  });

  it("keys post-scoped collections by organization and post", () => {
    const collections = createDashboardCollections({
      client: createClient(),
      scope: postScope,
    });

    expect(collections.commentCollection.id).toBe(
      "commentCollection:org_a:dark-mode"
    );
  });

  it("never shares a collection between two scopes on one client", () => {
    const client = createClient();
    const first = createDashboardCollections({
      client,
      scope: organizationScope,
    });
    const second = createDashboardCollections({ client, scope: postScope });

    expect(first.commentCollection.id).not.toBe(second.commentCollection.id);
    expect(first.commentCollection).not.toBe(second.commentCollection);
  });

  it("returns the same collection for the same scope, so React deps are stable", () => {
    const client = createClient();
    const first = createDashboardCollections({
      client,
      scope: organizationScope,
    });
    const second = createDashboardCollections({
      client,
      scope: { ...organizationScope },
    });

    expect(first.postCollection).toBe(second.postCollection);
  });

  it("leaves the organization-less collections unscoped and shared", () => {
    const client = createClient();
    const first = createDashboardCollections({
      client,
      scope: organizationScope,
    });
    const second = createDashboardCollections({ client, scope: postScope });

    expect(first.membershipCollection.id).toBe("membershipCollection");
    expect(first.membershipCollection).toBe(second.membershipCollection);
  });

  it("applies join indexes once per collection id", () => {
    const client = createClient();
    const collections = createDashboardCollections({
      client,
      scope: organizationScope,
    });

    // A second set for the same scope re-reads the same collections; a second
    // `createIndex` on the same key would throw, so not throwing is the
    // assertion.
    expect(() =>
      createDashboardCollections({ client, scope: organizationScope })
    ).not.toThrow();
    expect(collections.postCollection.indexes.size).toBeGreaterThan(0);
  });
});
