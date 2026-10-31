import { describe, expect, it } from "vitest";

import {
  buildDashboardWebMcpTools,
  dashboardPagePath,
  registerWebMcpTools,
} from "./webmcp";

describe("dashboard WebMCP tools", () => {
  it("maps only the pages the tools may open", () => {
    expect(dashboardPagePath("sign-in")).toBe("/sign-in");
    expect(dashboardPagePath("sign-up")).toBe("/sign-up");
    expect(dashboardPagePath("forgot-password")).toBe("/forgot-password");
    expect(dashboardPagePath("settings")).toBeUndefined();
    expect(dashboardPagePath("../admin")).toBeUndefined();
  });

  it("publishes unique, schema-described tools", () => {
    const tools = buildDashboardWebMcpTools("https://api.example.test");
    const names = tools.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).not.toBe("");
    }
  });

  it("constrains the page tool to the signed-out routes", () => {
    const pageTool = buildDashboardWebMcpTools("https://api.example.test").find(
      (tool) => tool.name === "open_dashboard_page"
    );

    expect(pageTool?.inputSchema.properties.page?.enum).toEqual([
      "sign-in",
      "sign-up",
      "forgot-password",
    ]);
  });

  it("registers nothing without a browser page", () => {
    const unregister = registerWebMcpTools({
      rootDomain: "feeblo.com",
      apiUrl: "https://api.feeblo.com",
    });

    expect(unregister).toBeTypeOf("function");
    expect(() => unregister()).not.toThrow();
  });
});
