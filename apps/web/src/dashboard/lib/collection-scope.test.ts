import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  organizationScopedCollectionId,
  organizationScopedQueryKey,
  scopePostSlug,
  slugScopedCollectionId,
  slugScopedQueryKey,
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

describe("scope-derived query keys", () => {
  const postSlugFilter = (value: string) => [
    { field: ["postSlug"], operator: "eq", value },
  ];

  it("keys an organization-scoped collection by its scope", () => {
    expect(organizationScopedQueryKey(orgA, "post")).toEqual(["post", "org-a"]);
    expect(organizationScopedQueryKey(orgB, "post")).toEqual(["post", "org-b"]);
  });

  it("prefers an explicit postSlug filter over the scope's slug", () => {
    expect(
      slugScopedQueryKey(orgA, "comment", postSlugFilter("post-2"))
    ).toEqual(["comment", "org-a", "postSlug", "post-2"]);
  });

  it("falls back to the slug captured in the scope", () => {
    expect(slugScopedQueryKey(orgA, "comment")).toEqual([
      "comment",
      "org-a",
      "postSlug",
      "post-1",
    ]);
    expect(
      scopePostSlug({ organizationId: "org-a", postSlug: undefined })
    ).toBeUndefined();
  });

  it("carries extra key parts after the slug", () => {
    expect(
      slugScopedQueryKey(orgA, "post-subscription", undefined, "user-1")
    ).toEqual(["post-subscription", "org-a", "postSlug", "post-1", "user-1"]);
  });

  it("falls back to the bare name without an organization", () => {
    expect(
      organizationScopedQueryKey(
        { organizationId: undefined, postSlug: undefined },
        "post"
      )
    ).toEqual(["post"]);
  });
});

/**
 * Source-level guard for the invariant the unit tests above encode: a collection
 * whose `queryKey` resolves a slug from the route must key its descriptor by
 * slug too. Without this, a collection added later could reintroduce the
 * cross-post bleed the slug id exists to prevent, and no unit test would see it.
 */
describe("collections module invariants", () => {
  const source = readFileSync(
    new URL("./collections.ts", import.meta.url),
    "utf8"
  );

  /**
   * Splits `function NAME(...) { ... }` blocks by brace matching.
   *
   * The descriptors are module-private — `dashboardCollections` is the only
   * interface a caller sees — so this reads them without requiring an export.
   */
  function descriptorBlocks(): Array<{ name: string; body: string }> {
    const blocks: Array<{ name: string; body: string }> = [];
    const re = /^(?:export )?(?:async )?function (\w+Collection)\(/gm;
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

  it("finds every collection descriptor", () => {
    expect(blocks.length).toBe(33);
  });

  it("keys every route-slug-scoped collection by slug", () => {
    const slugScoped = blocks.filter((b) =>
      /getPostSlug\(\)|scopePostSlug\(|slugScopedQueryKey\(/.test(b.body)
    );

    expect(slugScoped.length).toBeGreaterThan(0);
    for (const block of slugScoped) {
      expect(
        block.body,
        `${block.name} resolves a route slug but does not use slugScopedCollectionId`
      ).toContain("slugScopedCollectionId(");
    }
  });

  it("keys every org-scoped collection by organization", () => {
    for (const block of blocks) {
      if (block.body.includes("slugScopedCollectionId(")) continue;
      if (!block.body.includes("organizationScopedQueryKey(")) continue;
      expect(
        block.body,
        `${block.name} is org-scoped but does not use organizationScopedCollectionId`
      ).toContain("organizationScopedCollectionId(");
    }
  });

  it("gives every descriptor a unique id", () => {
    const ids = blocks.map((b) => b.name);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
