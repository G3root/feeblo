import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptsMarkdown,
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
  wellKnownPath,
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

  it("emits the Server Card extension's required fields", () => {
    vi.stubEnv("API_URL", "https://api.example.test");
    const card = dashboardMcpServerCard();

    expect(card.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"
    );
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/u);
    expect(card.version).not.toBe("");
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.remotes[0]).toMatchObject({
      type: "streamable-http",
      url: "https://api.example.test/mcp",
    });
    expect(card.remotes[0]?.headers[0]).toMatchObject({
      name: "x-api-key",
      isRequired: true,
      isSecret: true,
    });
    expect(card.remotes[0]?.headers[0]).not.toHaveProperty("value");
  });

  it("restores the well-known prefix the splat route strips", () => {
    expect(wellKnownPath("api-catalog")).toBe("/.well-known/api-catalog");
    expect(wellKnownPath("/mcp/server-card.json")).toBe(
      "/.well-known/mcp/server-card.json"
    );
    expect(wellKnownPath(undefined)).toBe("/.well-known/");
  });

  it("selects Markdown only when it is explicitly accepted", () => {
    expect(acceptsMarkdown("text/markdown")).toBe(true);
    expect(acceptsMarkdown("text/html, text/markdown;q=0.9")).toBe(true);
    expect(acceptsMarkdown("text/markdown;q=0")).toBe(false);
    expect(acceptsMarkdown("text/markdown;Q=0")).toBe(false);
    expect(acceptsMarkdown("TEXT/MARKDOWN")).toBe(true);
    expect(acceptsMarkdown("text/html, */*;q=0.8")).toBe(false);
    expect(acceptsMarkdown(null)).toBe(false);
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
      `<${DASHBOARD_AGENT_CATALOG_PATH}>; rel="ai-catalog"; type="application/ai-catalog+json"`
    );
  });
});
