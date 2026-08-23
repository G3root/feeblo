import { describe, expect, it } from "vitest";

import {
  createRpcCollectionHelpers,
  eqFilterValue,
  organizationScopedKey,
  postSlugFromPath,
} from "./collections";

describe("eqFilterValue", () => {
  it("returns the value of the first matching eq filter", () => {
    expect(
      eqFilterValue(
        [
          { field: ["other"], operator: "eq", value: "nope" },
          { field: ["post", "slug"], operator: "eq", value: "hello" },
        ],
        "post.slug"
      )
    ).toBe("hello");
  });

  it("joins dotted field paths for comparison", () => {
    expect(
      eqFilterValue(
        [{ field: ["postId"], operator: "eq", value: "p1" }],
        "postId"
      )
    ).toBe("p1");
  });

  it("ignores non-eq operators and unknown fields", () => {
    expect(
      eqFilterValue(
        [
          { field: ["postSlug"], operator: "like", value: "x" },
          { field: ["unrelated"], operator: "eq", value: "y" },
        ],
        "postSlug"
      )
    ).toBeUndefined();
  });

  it("returns undefined for an empty filter list", () => {
    expect(eqFilterValue([], "postSlug")).toBeUndefined();
  });
});

describe("organizationScopedKey", () => {
  it("scopes the key when an organization id is present", () => {
    expect(organizationScopedKey("org_1", "comment")).toEqual([
      "comment",
      "org_1",
    ]);
  });

  it("falls back to the bare scope without an organization id", () => {
    expect(organizationScopedKey(undefined, "comment")).toEqual(["comment"]);
  });

  it("appends truthy parts and skips empty ones", () => {
    expect(
      organizationScopedKey("org_1", "comment", "postSlug", "hello", undefined)
    ).toEqual(["comment", "org_1", "postSlug", "hello"]);
  });
});

describe("postSlugFromPath", () => {
  it("reads the dashboard shape /:org/.../post/:boardSlug/:postSlug", () => {
    expect(postSlugFromPath("/acme/post/general/my-slug", "post", 2)).toBe(
      "my-slug"
    );
  });

  it("reads the public board shape /p/:slug", () => {
    expect(postSlugFromPath("/p/public-slug", "p", 1)).toBe("public-slug");
  });

  it("decodes percent-encoded slugs", () => {
    expect(postSlugFromPath("/p/100%25-done", "p", 1)).toBe("100%-done");
  });

  it("returns undefined outside a post page", () => {
    expect(postSlugFromPath("/acme/roadmap", "post", 2)).toBeUndefined();
  });

  it("returns undefined when the slug segment is missing", () => {
    expect(postSlugFromPath("/acme/post/board", "post", 2)).toBeUndefined();
  });

  it("returns undefined for malformed percent-encoding instead of throwing", () => {
    expect(postSlugFromPath("/p/%zz", "p", 1)).toBeUndefined();
  });
});

describe("createRpcCollectionHelpers", () => {
  const helpers = createRpcCollectionHelpers({
    getOrganizationId: () => "org_9",
    getPostSlug: () => "route-slug",
  });

  it("binds organization scoping into query keys", () => {
    expect(helpers.organizationScopedQueryKey("upvote")).toEqual([
      "upvote",
      "org_9",
    ]);
  });

  it("prefers an explicit postSlug filter over the route slug", () => {
    expect(
      helpers.resolvePostSlug([
        { field: ["postSlug"], operator: "eq", value: "explicit" },
      ])
    ).toBe("explicit");
  });

  it("falls back to the route slug without filters", () => {
    expect(helpers.resolvePostSlug()).toBe("route-slug");
    expect(helpers.slugScopedQueryKey("comment")).toEqual([
      "comment",
      "org_9",
      "postSlug",
      "route-slug",
    ]);
  });

  it("produces unscoped keys when neither filter nor route provides a slug", () => {
    const anonymous = createRpcCollectionHelpers({
      getOrganizationId: () => undefined,
      getPostSlug: () => undefined,
    });

    expect(anonymous.slugScopedQueryKey("comment")).toEqual(["comment"]);
    expect(anonymous.resolvePostSlug([])).toBeUndefined();
  });
});
