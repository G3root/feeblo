import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_AGENT_CATALOG_PATH,
  DASHBOARD_API_CATALOG_PATH,
  DASHBOARD_AUTH_PATH,
  DASHBOARD_DISCOVERY_LINK,
  DASHBOARD_MCP_SERVER_CARD_PATH,
  dashboardAgentCatalog,
  dashboardApiCatalog,
  dashboardAuthMarkdown,
  dashboardMarkdown,
  dashboardMcpServerCard,
} from "./agent-discovery";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard discovery documents", () => {
  it("titles the auth guide so an auth-md reader finds it", () => {
    const body = dashboardAuthMarkdown("https://app.feeblo.com");

    expect(body.split("\n")[0]).toContain("auth.md");
    expect(body).toContain("Settings → Developers");
  });

  it("describes the configured API origin rather than the dashboard host", () => {
    vi.stubEnv("API_URL", "https://api.example.test");

    expect(dashboardMcpServerCard().endpoint).toBe(
      "https://api.example.test/mcp"
    );
    expect(dashboardApiCatalog().linkset[0]?.anchor).toBe(
      "https://api.example.test/api/v1"
    );
    expect(dashboardAgentCatalog().entries[0]?.url).toBe(
      "https://api.example.test/.well-known/mcp/server-card.json"
    );
  });

  it("falls back to the hosted API when no origin is configured", () => {
    vi.stubEnv("API_URL", "");

    expect(dashboardMcpServerCard().endpoint).toBe(
      "https://api.feeblo.com/mcp"
    );
  });

  it("keys ARD entries by the API host and gives each one locator", () => {
    vi.stubEnv("API_URL", "https://api.example.test");
    const catalog = dashboardAgentCatalog();

    expect(catalog.entries.length).toBeGreaterThan(0);

    for (const entry of catalog.entries) {
      expect(entry.identifier.startsWith("urn:air:api.example.test:")).toBe(
        true
      );
      // Spec section 3.4: exactly one of `url` and `data`, never both.
      expect(entry.url).toBeDefined();
      expect(entry).not.toHaveProperty("data");
    }
  });

  it("advertises the discovery set on the root document", () => {
    const markdown = dashboardMarkdown("https://app.feeblo.com");

    expect(markdown.split("\n")[0]).toBe("# Feeblo");
    expect(markdown).toContain("https://app.feeblo.com/auth.md");
    expect(markdown).toContain("https://api.feeblo.com/mcp");
  });

  it("links every discovery document with a registered relation", () => {
    expect(DASHBOARD_DISCOVERY_LINK).toContain(
      `<${DASHBOARD_AUTH_PATH}>; rel="describedby"`
    );
    expect(DASHBOARD_DISCOVERY_LINK).toContain(
      `<${DASHBOARD_MCP_SERVER_CARD_PATH}>; rel="service-desc"`
    );
    expect(DASHBOARD_DISCOVERY_LINK).toContain(
      `<${DASHBOARD_API_CATALOG_PATH}>; rel="api-catalog"`
    );
    expect(DASHBOARD_DISCOVERY_LINK).toContain(
      `<${DASHBOARD_AGENT_CATALOG_PATH}>; rel="describedby"`
    );
  });
});
