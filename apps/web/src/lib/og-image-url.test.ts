import { describe, expect, it } from "vitest";

import { buildOgImageUrl } from "./og-image-url";

const API_URL = "https://api.feeblo.com";
const SITE_ID = "sit_01jq8z3k4m5n6p7q8r9s0t1v2w";

/** The query string as an object, which is the shape `OgImageRequest` decodes. */
function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

function pageTypeOf(url: string): string | undefined {
  return paramsOf(url).type;
}

describe("buildOgImageUrl", () => {
  it("points at the API's og-image endpoint on an absolute URL", () => {
    const url = buildOgImageUrl({
      apiUrl: API_URL,
      pathname: "/",
      postSlug: null,
      siteId: SITE_ID,
    });

    expect(new URL(url).origin).toBe(API_URL);
    expect(new URL(url).pathname).toBe("/og-image");
  });

  it("identifies the board by id, never by name or subdomain", () => {
    const url = buildOgImageUrl({
      apiUrl: API_URL,
      pathname: "/",
      postSlug: null,
      siteId: SITE_ID,
    });

    // The renderer resolves the site from `siteId`, so `name` and `site` are
    // rejected by the request schema — the params they replaced are a 400.
    expect(paramsOf(url)).toEqual({ siteId: SITE_ID, type: "feedback-main" });
    expect(paramsOf(url)).not.toHaveProperty("name");
    expect(paramsOf(url)).not.toHaveProperty("site");
  });

  it("uses the feedback image for the board root and a board view", () => {
    for (const pathname of ["/", "/b/feature-requests"]) {
      const url = buildOgImageUrl({
        apiUrl: API_URL,
        pathname,
        postSlug: null,
        siteId: SITE_ID,
      });

      expect(pageTypeOf(url)).toBe("feedback-main");
    }
  });

  it("uses the roadmap image for the roadmap and its filters", () => {
    for (const pathname of ["/roadmap", "/roadmap/in-progress"]) {
      const url = buildOgImageUrl({
        apiUrl: API_URL,
        pathname,
        postSlug: null,
        siteId: SITE_ID,
      });

      expect(pageTypeOf(url)).toBe("roadmap-main");
    }
  });

  it("uses the changelog image for the changelog and its entries", () => {
    for (const pathname of ["/changelog", "/changelog/1-2-0"]) {
      const url = buildOgImageUrl({
        apiUrl: API_URL,
        pathname,
        postSlug: null,
        siteId: SITE_ID,
      });

      expect(pageTypeOf(url)).toBe("changelog-main");
    }
  });

  it("carries the slug for a post detail, whose image embeds live counts", () => {
    const url = buildOgImageUrl({
      apiUrl: API_URL,
      pathname: "/p/dark-mode",
      postSlug: "dark-mode",
      siteId: SITE_ID,
    });

    expect(paramsOf(url)).toEqual({
      siteId: SITE_ID,
      type: "post-detail",
      post: "dark-mode",
    });
  });
});
