import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  dashboardScopeFromPathname,
  dashboardScopeKey,
  organizationScopedCollectionId,
  slugScopedCollectionId,
  workspaceIdFromPathname,
} from "./collection-scope";

const orgA = { organizationId: "org-a", postSlug: "post-1" };
const orgB = { organizationId: "org-b", postSlug: "post-1" };

describe("organizationScopedCollectionId", () => {
  it("keys a collection by organization", () => {
    expect(organizationScopedCollectionId("postCollection", orgA)).toBe(
      "postCollection:org-a"
    );
    expect(organizationScopedCollectionId("postCollection", orgB)).not.toBe(
      organizationScopedCollectionId("postCollection", orgA)
    );
  });

  it("ignores the post slug, so on-demand subsets still share one collection", () => {
    expect(
      organizationScopedCollectionId("postCollection", {
        organizationId: "org-a",
        postSlug: "post-1",
      })
    ).toBe(
      organizationScopedCollectionId("postCollection", {
        organizationId: "org-a",
        postSlug: "post-2",
      })
    );
  });

  it("falls back to a bare id when there is no organization", () => {
    expect(
      organizationScopedCollectionId("postCollection", {
        organizationId: undefined,
        postSlug: undefined,
      })
    ).toBe("postCollection");
  });
});

describe("slugScopedCollectionId", () => {
  it("keys by post so a query-key slug fallback cannot cross posts", () => {
    const post1 = slugScopedCollectionId("commentCollection", {
      organizationId: "org-a",
      postSlug: "post-1",
    });
    const post2 = slugScopedCollectionId("commentCollection", {
      organizationId: "org-a",
      postSlug: "post-2",
    });

    expect(post1).toBe("commentCollection:org-a:post-1");
    expect(post1).not.toBe(post2);
  });

  it("still separates organizations for the same slug", () => {
    expect(slugScopedCollectionId("commentCollection", orgA)).not.toBe(
      slugScopedCollectionId("commentCollection", orgB)
    );
  });

  it("falls back to the org-scoped id without a slug", () => {
    const scope = { organizationId: "org-a", postSlug: undefined };

    expect(slugScopedCollectionId("commentCollection", scope)).toBe(
      organizationScopedCollectionId("commentCollection", scope)
    );
  });
});

/**
 * The query-key rules themselves live in `@feeblo/web-shared/collections` and
 * are tested there; what is worth pinning here is that a dashboard pathname
 * yields the scope those rules are applied to.
 */
describe("dashboardScopeFromPathname", () => {
  it("reads the organization and the post slug from a dashboard post route", () => {
    expect(
      dashboardScopeFromPathname(
        "/org_abc123/board/feature-requests/post/b1/dark-mode"
      )
    ).toEqual({ organizationId: "org_abc123", postSlug: "dark-mode" });
  });

  it("leaves the slug undefined outside a post route", () => {
    expect(dashboardScopeFromPathname("/org_abc123/settings/members")).toEqual({
      organizationId: "org_abc123",
      postSlug: undefined,
    });
  });

  it("resolves no organization for the routes that share the dashboard's parent", () => {
    for (const pathname of [
      "/",
      "/sign-in",
      "/register",
      "/invitation/inv_abc123",
      "/s/acme/p/dark-mode",
    ]) {
      expect(dashboardScopeFromPathname(pathname)).toEqual({
        organizationId: undefined,
        postSlug: undefined,
      });
    }
  });

  it("does not mistake the public board's post shape for a dashboard post", () => {
    // `/s/<host>/p/<slug>` is served by the same app; its slug offset must not
    // leak into a dashboard scope.
    expect(
      dashboardScopeFromPathname("/s/acme/p/dark-mode").postSlug
    ).toBeUndefined();
  });
});

describe("dashboardScopeKey", () => {
  it("is stable for equal scopes built separately", () => {
    expect(dashboardScopeKey({ ...orgA })).toBe(dashboardScopeKey({ ...orgA }));
  });

  it("separates organizations and posts", () => {
    expect(dashboardScopeKey(orgA)).not.toBe(dashboardScopeKey(orgB));
    expect(dashboardScopeKey(orgA)).not.toBe(
      dashboardScopeKey({ ...orgA, postSlug: "post-2" })
    );
  });

  it("matches the ids a scope produces, so one memo entry per collection set", () => {
    // An absent organization and an empty one produce the same ids, so they
    // must produce the same key rather than two entries holding one set.
    expect(
      dashboardScopeKey({ organizationId: undefined, postSlug: undefined })
    ).toBe(dashboardScopeKey({ organizationId: "", postSlug: undefined }));
  });
});

/**
 * Source-level guards for invariants the unit tests above cannot see: they hold
 * between descriptors, not inside one. Without them a collection added later
 * could reintroduce the cross-post bleed the slug id exists to prevent, or be
 * built but never handed to a caller.
 */
describe("collections module invariants", () => {
  const source = readFileSync(
    new URL("./collections.ts", import.meta.url),
    "utf8"
  );

  /** Splits `function NAME(deps) { ... }` blocks by brace matching. */
  function descriptorBlocks(): Array<{ name: string; body: string }> {
    const blocks: Array<{ name: string; body: string }> = [];
    const re = /^function (\w+Collection)\(/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) {
      const braceOpen = source.indexOf("{", match.index);
      let depth = 0;
      let end = braceOpen;
      for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      blocks.push({ name: match[1], body: source.slice(braceOpen, end) });
    }
    return blocks;
  }

  const blocks = descriptorBlocks();
  const built = source.slice(
    source.indexOf("export function createDashboardCollections("),
    source.indexOf("export type DashboardCollections")
  );

  it("finds every collection descriptor", () => {
    expect(blocks.length).toBe(33);
  });

  it("keys every route-slug-scoped collection by slug", () => {
    const slugScoped = blocks.filter((b) =>
      /resolvePostSlug\(|slugScopedQueryKey\(/.test(b.body)
    );

    expect(slugScoped.length).toBeGreaterThan(0);
    for (const block of slugScoped) {
      expect(
        block.body,
        `${block.name} resolves a route slug but does not use slugCollectionId`
      ).toContain("deps.slugCollectionId(");
    }
  });

  it("keys every org-scoped collection by organization", () => {
    for (const block of blocks) {
      if (block.body.includes("deps.slugCollectionId(")) continue;
      if (!block.body.includes("deps.organizationScopedQueryKey(")) continue;
      expect(
        block.body,
        `${block.name} is org-scoped but does not use collectionId`
      ).toContain("deps.collectionId(");
    }
  });

  it("gives every descriptor a unique name", () => {
    const names = blocks.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("materializes every descriptor in createDashboardCollections", () => {
    for (const { name } of blocks) {
      expect(built, `${name} is not materialized for callers`).toContain(
        `${name}(deps)`
      );
    }
  });
});

describe("workspaceIdFromPathname", () => {
  it("returns the first segment when it is a workspace id", () => {
    expect(workspaceIdFromPathname("/org_abc123/settings/members")).toBe(
      "org_abc123"
    );
    expect(workspaceIdFromPathname("/org_abc123")).toBe("org_abc123");
    expect(workspaceIdFromPathname("org_abc123/")).toBe("org_abc123");
  });

  it("returns undefined for the paths that share the dashboard's parent route", () => {
    for (const pathname of [
      "/",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/register",
      "/invitation/inv_abc123",
      "/email-verify",
    ]) {
      expect(workspaceIdFromPathname(pathname)).toBeUndefined();
    }
  });
});
