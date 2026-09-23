import { describe, expect, it } from "vitest";

import {
  DASHBOARD_AUTH_PATHS,
  isDashboardHost,
  toInternalPath,
  toPublicPath,
} from "./public-board-rewrite";

const ROOT_DOMAIN = "example.com";

describe("isDashboardHost", () => {
  it("treats the apex and the app subdomain as dashboard hosts", () => {
    expect(isDashboardHost("example.com", ROOT_DOMAIN)).toBe(true);
    expect(isDashboardHost("app.example.com", ROOT_DOMAIN)).toBe(true);
    expect(isDashboardHost("APP.example.com", ROOT_DOMAIN)).toBe(true);
  });

  it("treats tenant subdomains as board hosts", () => {
    expect(isDashboardHost("acme.example.com", ROOT_DOMAIN)).toBe(false);
    expect(isDashboardHost("acme.app.example.com", ROOT_DOMAIN)).toBe(false);
  });

  it("does not claim unrelated hosts", () => {
    expect(isDashboardHost("example.org", ROOT_DOMAIN)).toBe(true);
    expect(isDashboardHost("localhost", "localhost")).toBe(true);
  });

  it("ignores the port", () => {
    expect(isDashboardHost("app.localhost:3001", "localhost")).toBe(true);
    expect(isDashboardHost("acme.localhost:3001", "localhost")).toBe(false);
  });
});

describe("toInternalPath", () => {
  it("leaves dashboard hosts untouched", () => {
    expect(toInternalPath("/p/hello", "app.example.com", ROOT_DOMAIN)).toBe(
      "/p/hello"
    );
    expect(toInternalPath("/", "example.com", ROOT_DOMAIN)).toBe("/");
  });

  it("prefixes board-host paths with /s", () => {
    expect(toInternalPath("/p/hello", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/s/p/hello"
    );
    expect(toInternalPath("/b/features", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/s/b/features"
    );
  });

  it("maps the board root to /s/", () => {
    expect(toInternalPath("/", "acme.example.com", ROOT_DOMAIN)).toBe("/s/");
  });

  it("keeps paths that are already internal", () => {
    expect(toInternalPath("/s/p/hello", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/s/p/hello"
    );
  });

  it("keeps the feedback widget on every host", () => {
    expect(
      toInternalPath("/feedback-widget/org_1", "acme.example.com", ROOT_DOMAIN)
    ).toBe("/feedback-widget/org_1");
  });

  it("keeps dashboard auth pages reachable from board hosts", () => {
    for (const path of DASHBOARD_AUTH_PATHS) {
      expect(toInternalPath(path, "acme.example.com", ROOT_DOMAIN)).toBe(path);
    }
  });

  it("keeps trailing slashes", () => {
    expect(toInternalPath("/roadmap/", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/s/roadmap/"
    );
  });
});

describe("toPublicPath", () => {
  it("leaves dashboard hosts untouched", () => {
    expect(toPublicPath("/p/hello", "app.example.com", ROOT_DOMAIN)).toBe(
      "/p/hello"
    );
  });

  it("strips the internal prefix on board hosts", () => {
    expect(toPublicPath("/s/p/hello", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/p/hello"
    );
    expect(toPublicPath("/s/", "acme.example.com", ROOT_DOMAIN)).toBe("/");
    expect(toPublicPath("/s", "acme.example.com", ROOT_DOMAIN)).toBe("/");
  });

  it("does not strip paths that merely start with /s", () => {
    expect(toPublicPath("/sign-in", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/sign-in"
    );
    expect(toPublicPath("/settings", "acme.example.com", ROOT_DOMAIN)).toBe(
      "/settings"
    );
  });
});
