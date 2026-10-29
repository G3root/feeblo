import { isDashboardHost } from "@/lib/public-board-rewrite";

/**
 * The dashboard's WebMCP tools.
 *
 * WebMCP lets a browser agent call the site's own actions instead of scraping
 * the DOM. Registration happens after hydration and only on the dashboard
 * host, because a public board or a customer's custom domain is not this
 * product.
 *
 * The tools are navigation only, and deliberately so: this page loads before a
 * session exists, and a tool that reads or writes workspace data would be
 * callable by an agent on a signed-out tab. Every page a tool can open is
 * mapped through a fixed table, so an invalid `page` value resolves to
 * `undefined` rather than being interpolated into a URL.
 */

type JsonSchemaProperty = {
  readonly type: "string";
  readonly description?: string;
  readonly enum?: ReadonlyArray<string>;
};

type JsonSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties: false;
};

type ToolResult = {
  readonly ok: boolean;
  readonly detail: string;
};

type Tool<Input> = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly execute: (input: Input) => Promise<ToolResult>;
};

type ModelContext = {
  readonly registerTool: (
    // `never` accepts a tool whose input is validated by its own `execute`:
    // the browser supplies raw JSON at runtime, not a typed value.
    tool: Tool<never>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<void>;
};

type ModelContextHost = {
  readonly modelContext?: ModelContext;
};

const DASHBOARD_PAGES = {
  "sign-in": "/sign-in",
  "sign-up": "/sign-up",
  "forgot-password": "/forgot-password",
} as const;

type DashboardPage = keyof typeof DASHBOARD_PAGES;

type OpenDashboardPageInput = { readonly page: string };

/** The path for a page name, or `undefined` when the name is not one of ours. */
export const dashboardPagePath = (page: string) =>
  Object.hasOwn(DASHBOARD_PAGES, page)
    ? // SAFETY: `hasOwn` established that `page` is a key of the table.
      DASHBOARD_PAGES[page as DashboardPage]
    : undefined;

const NO_INPUT: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const API_ORIGIN_FALLBACK = "https://api.feeblo.com";

/**
 * The absolute API origin to open.
 *
 * The browser env carries a relative `/api` in development, where the Vite
 * proxy makes the API same-origin with the dashboard. A reference page opened
 * from a tool must be absolute, so a relative value falls back to the hosted
 * API rather than resolving against the dashboard.
 */
const apiOrigin = (configuration: string) => {
  try {
    const url = new URL(configuration);
    return url.origin;
  } catch {
    return API_ORIGIN_FALLBACK;
  }
};

const openDashboardPage: Tool<OpenDashboardPageInput> = {
  name: "open_dashboard_page",
  description:
    "Open one of the dashboard's signed-out pages: sign in, create an account, or recover a password.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "string",
        enum: Object.keys(DASHBOARD_PAGES),
        description: "Which page to open.",
      },
    },
    required: ["page"],
    additionalProperties: false,
  },
  execute: async (input) => {
    const path = dashboardPagePath(input.page);

    if (path === undefined) {
      return { ok: false, detail: `unknown page: ${input.page}` };
    }

    window.location.assign(path);
    return { ok: true, detail: `opened ${path}` };
  },
};

const openApiReference = (configuration: string): Tool<object> => ({
  name: "open_api_reference",
  description:
    "Open the Public API reference, where every endpoint, request body and response is documented.",
  inputSchema: NO_INPUT,
  execute: async () => {
    const url = `${apiOrigin(configuration)}/api/v1/docs`;
    window.location.assign(url);

    return { ok: true, detail: `opened ${url}` };
  },
});

const openDocumentation = (): Tool<object> => ({
  name: "open_documentation",
  description:
    "Open the Feeblo documentation: the widget SDK, identity, HTTP API, webhooks, and self-hosting.",
  inputSchema: NO_INPUT,
  execute: async () => {
    window.location.assign("https://docs.feeblo.com");

    return { ok: true, detail: "opened https://docs.feeblo.com" };
  },
});

/**
 * The tool set for one deployment.
 *
 * Built per registration because the API origin comes from the request's env,
 * which on Workers is request-scoped and cannot be read at module scope.
 */
export const buildDashboardWebMcpTools = (apiUrl: string) =>
  [openDashboardPage, openApiReference(apiUrl), openDocumentation()] as const;

/**
 * The WebMCP namespace, whichever one the browser exposes.
 *
 * Current Chrome builds put it on `document.modelContext`; earlier ones put it
 * on `navigator.modelContext`, and the two are the same object shape.
 */
const modelContext = (): ModelContext | null => {
  // SAFETY: The DOM lib does not declare `modelContext` yet; the value is the
  // page's document, and the property is checked for presence below.
  const documentHost = document as Document & ModelContextHost;

  if (documentHost.modelContext !== undefined) {
    return documentHost.modelContext;
  }

  // SAFETY: The DOM lib does not declare `modelContext` yet; the value is the
  // page's navigator, and only an existing namespace is returned.
  const navigatorHost = navigator as Navigator & ModelContextHost;
  return navigatorHost.modelContext ?? null;
};

/**
 * Registers the tools and returns the unregister function.
 *
 * Registration is best-effort: a browser without WebMCP, or a host that is not
 * the dashboard, gets a no-op. A failed registration must not surface to the
 * person using the page, because the page works without it.
 */
export const registerWebMcpTools = (input: {
  readonly rootDomain: string;
  readonly apiUrl: string;
}) => {
  if (!("window" in globalThis)) {
    return () => {};
  }

  if (!isDashboardHost(window.location.hostname, input.rootDomain)) {
    return () => {};
  }

  const context = modelContext();

  if (context === null) {
    return () => {};
  }

  const controller = new AbortController();

  for (const tool of buildDashboardWebMcpTools(input.apiUrl)) {
    // SAFETY: `Tool<Input>` is assignable to `Tool<never>`: the input parameter
    // is contravariant, and each tool validates its own input at execute time.
    void context
      .registerTool(tool as Tool<never>, { signal: controller.signal })
      .catch(() => {
        // A browser that exposes the namespace can still refuse a tool. The
        // remaining tools are independent, so one refusal is not fatal.
      });
  }

  return () => controller.abort();
};
