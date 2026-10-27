import { describe, expect, it } from "vitest";

import { pageContext } from "./posthog-provider";

/**
 * `pageContext` is the only route information PostHog receives. These cases
 * pin that the tenant id in the first URL segment never becomes a property,
 * that settings sub-pages collapse to a fixed vocabulary, and that a resource
 * slug is reduced to "detail".
 */
describe("pageContext", () => {
  const organizationId = "org_01abcdef";

  it("reads the section after the organization id", () => {
    expect(pageContext(`/${organizationId}/board/roadmap`)).toEqual({
      page: "board",
      page_kind: "index",
    });
  });

  it("never includes the organization id or a resource slug", () => {
    const context = pageContext(`/${organizationId}/post/board-slug/post-slug`);
    expect(JSON.stringify(context)).not.toContain(organizationId);
    expect(JSON.stringify(context)).not.toContain("post-slug");
    expect(context).toEqual({ page: "post", page_kind: "detail" });
  });

  it("names the settings sub-page as a tab", () => {
    expect(pageContext(`/${organizationId}/settings/members`)).toEqual({
      page: "settings",
      page_kind: "index",
      tab: "members",
    });
  });

  it("collapses an unknown section to home", () => {
    expect(pageContext("/")).toEqual({ page: "home", page_kind: "index" });
    expect(pageContext(`/${organizationId}/something-new`)).toEqual({
      page: "home",
      page_kind: "index",
    });
  });
});
