import { describe, expect, it } from "vitest";

import { createCollectionContext } from "./collection-context";
import { firstPathSegment, postSlugFromPath } from "./collections";

describe("createCollectionContext", () => {
  it("starts without an organization and publishes one", () => {
    const context = createCollectionContext({ getPostSlug: () => undefined });

    expect(context.getOrganizationId()).toBeUndefined();

    context.setOrganizationId("org_1");
    expect(context.getOrganizationId()).toBe("org_1");

    context.setOrganizationId(undefined);
    expect(context.getOrganizationId()).toBeUndefined();
  });

  it("resolves a slug at call time, not at creation time", () => {
    let pathname = "/p/first";
    const context = createCollectionContext({
      getPostSlug: () => postSlugFromPath(pathname, "p", 1),
    });

    expect(context.getPostSlug()).toBe("first");

    pathname = "/p/second";
    expect(context.getPostSlug()).toBe("second");
  });

  it("records preload degradation for the request", () => {
    const context = createCollectionContext({ getPostSlug: () => undefined });

    expect(context.isPreloadDegraded()).toBe(false);

    context.markPreloadDegraded();
    expect(context.isPreloadDegraded()).toBe(true);
  });

  it("reports no changelog slug on a surface that has none", () => {
    const context = createCollectionContext({ getPostSlug: () => undefined });

    expect(context.getChangelogSlug()).toBeUndefined();
  });

  it("resolves the organization from the surface until one is published", () => {
    const pathname = "/org_1/board/slug";
    const context = createCollectionContext({
      getOrganizationId: () => firstPathSegment(pathname),
      getPostSlug: () => undefined,
    });

    expect(context.getOrganizationId()).toBe("org_1");

    context.setOrganizationId("org_2");
    expect(context.getOrganizationId()).toBe("org_2");

    // Clearing hands resolution back to the surface, which is how a dashboard
    // page discards a value a board published on the same client.
    context.setOrganizationId(undefined);
    expect(context.getOrganizationId()).toBe("org_1");
  });
});
