import type {
  THelpCenterArticlePublic,
  THelpCenterArticlePublicSummary,
} from "@feeblo/domain/help-center-article/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import { describe, expect, it } from "vitest";

import {
  handleHelpCenterMcp,
  type HelpCenterMcpDependencies,
} from "./help-center-mcp";

const ORIGIN = "https://acme.example.test";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

type JsonObject = { readonly [key: string]: JsonValue };

interface RpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: JsonObject;
}

interface RpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: JsonObject;
}

interface JsonRpcResponse {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result?: {
    readonly content?: ReadonlyArray<{ readonly text: string }>;
    readonly isError?: boolean;
    readonly instructions?: string;
    readonly protocolVersion?: string;
    readonly serverInfo?: { readonly name: string };
    readonly tools?: ReadonlyArray<{ readonly name: string }>;
  };
}

const site = (): TSite => ({
  changelogVisibility: "PUBLIC",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  customDomain: null,
  helpCenterVisibility: "PUBLIC",
  hidePoweredBy: false,
  id: "site_1",
  logo: null,
  name: "Acme",
  noIndex: false,
  organizationId: "org_1",
  roadmapVisibility: "PUBLIC",
  subdomain: "acme",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const article: THelpCenterArticlePublic = {
  authorName: "Ada",
  content: "Feeblo is a customer feedback platform.",
  coverImage: null,
  excerpt: "Feeblo is a customer feedback platform.",
  id: "article_1",
  isArchived: false,
  publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  slug: "what-is-feeblo",
  title: "What is Feeblo?",
  topicId: "topic_1",
  topicName: "Getting started",
  topicSlug: "getting-started",
  updatedAt: new Date("2026-07-28T00:00:00.000Z"),
  viewCount: 0,
};

const summary: THelpCenterArticlePublicSummary = {
  excerpt: article.excerpt,
  id: article.id,
  isArchived: false,
  publishedAt: article.publishedAt,
  slug: article.slug,
  title: article.title,
  topicId: article.topicId,
  topicName: article.topicName,
  topicSlug: article.topicSlug,
  updatedAt: article.updatedAt,
};

const dependencies = (
  overrides: Partial<HelpCenterMcpDependencies> = {}
): HelpCenterMcpDependencies => ({
  getArticle: async (slug) => (slug === article.slug ? article : null),
  listArticles: async () => [summary],
  origin: ORIGIN,
  site: site(),
  ...overrides,
});

const postJson = (body: RpcRequest | RpcNotification, init: RequestInit = {}) =>
  new Request(`${ORIGIN}/mcp`, {
    body: JSON.stringify(body),
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    method: "POST",
    ...init,
  });

const postRaw = (body: string, init: RequestInit = {}) =>
  new Request(`${ORIGIN}/mcp`, {
    body,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    method: "POST",
    ...init,
  });

const rpc = (id: number, method: string, params?: JsonObject): RpcRequest => ({
  id,
  jsonrpc: "2.0",
  method,
  ...(params === undefined ? {} : { params }),
});

const responseBody = async (response: Response) =>
  // SAFETY: every JSON response below is the handler's own JSON-RPC envelope,
  // which the assertion names field by field.
  (await response.json()) as JsonRpcResponse;

describe("handleHelpCenterMcp", () => {
  it("negotiates the requested protocol revision and advertises tools", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(1, "initialize", { protocolVersion: "2025-03-26" })
      ),
    });

    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body.result?.protocolVersion).toBe("2025-03-26");
    expect(body.result?.serverInfo?.name).toBe("acme-help");
    expect(body.result?.instructions).toContain("list_help_articles");
  });

  it("answers an unknown protocol revision with the newest one it speaks", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(1, "initialize", { protocolVersion: "1999-01-01" })
      ),
    });

    expect((await responseBody(response)).result?.protocolVersion).toBe(
      "2025-06-18"
    );
  });

  it("lists the two read-only tools", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(rpc(2, "tools/list")),
    });

    const tools = (await responseBody(response)).result?.tools ?? [];

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_help_articles",
      "get_help_article",
    ]);
  });

  it("returns the index for list_help_articles", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(3, "tools/call", {
          arguments: {},
          name: "list_help_articles",
        })
      ),
    });

    const text = (await responseBody(response)).result?.content?.[0]?.text;

    expect(text).toContain("# Acme help center");
    expect(text).toContain(
      "https://acme.example.test/help/articles/raw/what-is-feeblo.md"
    );
  });

  it("returns one article's Markdown for get_help_article", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(4, "tools/call", {
          arguments: { slug: "what-is-feeblo" },
          name: "get_help_article",
        })
      ),
    });

    const text = (await responseBody(response)).result?.content?.[0]?.text;

    expect(text).toContain("# What is Feeblo?");
    expect(text).toContain("Feeblo is a customer feedback platform.");
  });

  it("reports a missing article as a tool error, not a protocol error", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(5, "tools/call", {
          arguments: { slug: "not-published" },
          name: "get_help_article",
        })
      ),
    });

    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("not-published");
  });

  it("rejects an unknown tool and an unknown method without calling the API", async () => {
    const unknownTool = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(
        rpc(6, "tools/call", { arguments: {}, name: "delete_everything" })
      ),
    });

    expect((await responseBody(unknownTool)).error?.code).toBe(-32602);

    const unknownMethod = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(rpc(7, "resources/list")),
    });

    expect((await responseBody(unknownMethod)).error?.code).toBe(-32601);
  });

  it("accepts a notification with no body", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("answers malformed and oversized bodies without dispatching", async () => {
    const malformed = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postRaw("{not json"),
    });

    expect((await responseBody(malformed)).error?.code).toBe(-32700);

    const oversized = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postRaw("x".repeat(65 * 1024)),
    });

    expect(oversized.status).toBe(413);
  });

  it("refuses a cross-origin request and a non-POST method", async () => {
    const crossOrigin = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(rpc(8, "tools/list"), {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example.test",
        },
      }),
    });

    expect(crossOrigin.status).toBe(403);

    const get = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: new Request(`${ORIGIN}/mcp`),
    });

    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
  });

  it("accepts a supported MCP-Protocol-Version header", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(rpc(10, "tools/list"), {
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
        },
      }),
    });

    expect(response.status).toBe(200);
  });

  it("rejects an unsupported MCP-Protocol-Version header before dispatch", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies(),
      request: postJson(rpc(11, "tools/list"), {
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "1999-01-01",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unsupported MCP-Protocol-Version");
  });

  it("reports a failing list read as a tool error, not a protocol error", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies({
        listArticles: async () => {
          throw new Error("API is down");
        },
      }),
      request: postJson(
        rpc(12, "tools/call", { arguments: {}, name: "list_help_articles" })
      ),
    });

    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("unavailable");
  });

  it("reports a failing article read as a tool error, not a protocol error", async () => {
    const response = await handleHelpCenterMcp({
      dependencies: dependencies({
        getArticle: async () => {
          throw new Error("API is down");
        },
      }),
      request: postJson(
        rpc(13, "tools/call", {
          arguments: { slug: "what-is-feeblo" },
          name: "get_help_article",
        })
      ),
    });

    const body = await responseBody(response);

    expect(body.error).toBeUndefined();
    expect(body.result?.isError).toBe(true);
  });
});
