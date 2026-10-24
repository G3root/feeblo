import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_ORIGINS,
  applyPageSecurityHeaders,
  isEmbeddedWidgetPath,
  pageSecurityHeaders,
  parseImageOrigins,
} from "./security-headers";

const dashboard = {
  pathname: "/org_1/boards",
  secureRequest: true,
} as const;

const imgSrcOf = (policy: string): string => {
  const directive = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("img-src "));
  return directive?.slice("img-src ".length) ?? "";
};

describe("isEmbeddedWidgetPath", () => {
  it("matches the widget shell and its hash-routed descendants", () => {
    expect(isEmbeddedWidgetPath("/feedback-widget")).toBe(true);
    expect(isEmbeddedWidgetPath("/feedback-widget/org_1")).toBe(true);
    expect(isEmbeddedWidgetPath("/feedback-widget/org_1/")).toBe(true);
  });

  it("does not match a path that merely shares the prefix", () => {
    expect(isEmbeddedWidgetPath("/feedback-widgets")).toBe(false);
    expect(isEmbeddedWidgetPath("/dashboard/feedback-widget")).toBe(false);
    expect(isEmbeddedWidgetPath("/")).toBe(false);
  });
});

describe("parseImageOrigins", () => {
  it("splits on commas, trims, reduces to an origin, and dedupes", () => {
    expect(
      parseImageOrigins([
        " https://media.example.com/prefix , https://cdn.example.com ",
        "https://media.example.com/prefix",
        undefined,
        "",
      ])
    ).toEqual(["https://media.example.com", "https://cdn.example.com"]);
  });

  it("keeps a loopback development origin with its port", () => {
    expect(parseImageOrigins(["http://localhost:9000"])).toEqual([
      "http://localhost:9000",
    ]);
  });

  it("drops values that are not absolute http(s) URLs", () => {
    expect(
      parseImageOrigins([
        "media.example.com",
        "/relative",
        "javascript:alert(1)",
        "data:text/html,x",
        "https://valid.example",
      ])
    ).toEqual(["https://valid.example"]);
  });

  it("cannot inject a second directive through a configured value", () => {
    const origins = parseImageOrigins(["https://ok.example; script-src *"]);
    expect(origins).toEqual([]);
  });
});

describe("pageSecurityHeaders", () => {
  it("refuses framing on the dashboard and names no legacy exception", () => {
    const headers = pageSecurityHeaders(dashboard);
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'"
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  it("allows the widget shell to be framed and omits DENY", () => {
    const headers = pageSecurityHeaders({
      pathname: "/feedback-widget/org_1",
      secureRequest: true,
    });
    expect(headers["content-security-policy"]).toContain("frame-ancestors *");
    expect(headers["x-frame-options"]).toBeUndefined();
  });

  it("allows only self, inline, uploaded media, and the OAuth avatar hosts", () => {
    const sources = imgSrcOf(
      pageSecurityHeaders({
        ...dashboard,
        imageOrigins: ["https://media.example.com"],
      })["content-security-policy"]
    ).split(" ");

    expect(sources).toContain("'self'");
    expect(sources).toContain("data:");
    expect(sources).toContain("blob:");
    expect(sources).toContain("https://media.example.com");
    for (const origin of DEFAULT_IMAGE_ORIGINS) {
      expect(sources).toContain(origin);
    }
  });

  it("never lets arbitrary remote images through", () => {
    const sources = imgSrcOf(
      pageSecurityHeaders(dashboard)["content-security-policy"]
    ).split(" ");

    // A bare `https:` (or `*`) source would allow every host again; only
    // explicit origins are permitted.
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("http:");
  });

  it("sends HSTS only on a secure request", () => {
    expect(
      pageSecurityHeaders(dashboard)["strict-transport-security"]
    ).toBeDefined();
    expect(
      pageSecurityHeaders({ ...dashboard, secureRequest: false })[
        "strict-transport-security"
      ]
    ).toBeUndefined();
  });
});

describe("applyPageSecurityHeaders", () => {
  it("attaches the policy without disturbing status or existing headers", () => {
    const response = new Response("body", {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 418,
    });

    const applied = applyPageSecurityHeaders(response, dashboard);

    expect(applied).toBe(response);
    expect(applied.status).toBe(418);
    expect(applied.headers.get("content-type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(applied.headers.get("x-frame-options")).toBe("DENY");
  });

  it("leaves a bodyless status bodyless", () => {
    const applied = applyPageSecurityHeaders(
      new Response(null, { status: 304 }),
      dashboard
    );

    expect(applied.status).toBe(304);
    expect(applied.body).toBeNull();
  });
});
