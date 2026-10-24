/**
 * Response security headers for every document the app serves.
 *
 * Two problems are fixed here, and they are the same header set:
 *
 * 1. **Framing.** The session cookie is `Domain=<root>; SameSite=None` in
 *    production so boards on tenant subdomains share the session. Browsers
 *    therefore attach it to a cross-site iframe, and a page that frames the
 *    dashboard gets an authenticated document it can clickjack. The API's CSRF
 *    origin check cannot see this: the framed page's requests are same-origin.
 *    Everything is `frame-ancestors 'none'` except the widget shell, which is
 *    the one document the product embeds.
 *
 * 2. **Third-party images in user content.** Post bodies, comments, and
 *    changelogs render author-supplied Markdown, and `MarkdownContent` writes
 *    it with `dangerouslySetInnerHTML`. A `![](https://attacker/pixel)` in a
 *    public post is fetched by every anonymous visitor, handing the embedder
 *    their IP (and, with `Referrer-Policy`, the page they came from). The
 *    `img-src` allow-list is what stops that fetch. Uploaded media comes from
 *    the object-storage origin, which is configured; avatars use the hosts the
 *    configured OAuth providers return; anything else must be uploaded or
 *    allow-listed by the operator (`CONTENT_IMAGE_ORIGINS`).
 *
 * Deliberately absent: `default-src`, `script-src`, `style-src`, `connect-src`.
 * This app inlines the runtime env script, ships Tailwind's generated CSS,
 * loads the widget bundle from a second dev origin, streams over WebSockets,
 * and (on the API) serves a Scalar reference page that fetches its own bundle.
 * A policy that set a fallback would break one of those on every deploy, so
 * this one constrains only the directives below. Add a directive here when its
 * breakage has been verified, not before.
 */

/**
 * Avatar hosts the codebase's configured OAuth providers return.
 *
 * Google and GitHub are the two social providers `packages/auth` wires, and
 * better-auth stores the provider's `picture`/`avatar_url` verbatim in
 * `user.image`, which the UI renders as an `<img>`. Without these, OAuth
 * members lose their avatars the moment the policy ships. Every other host —
 * a workspace's own SSO avatar, a CRM contact's avatar, a custom CDN — is the
 * operator's to declare in `CONTENT_IMAGE_ORIGINS`.
 */
export const DEFAULT_IMAGE_ORIGINS = [
  "https://*.googleusercontent.com",
  "https://avatars.githubusercontent.com",
] as const;

/** Path prefix of the embeddable widget document. */
const WIDGET_PATH = "/feedback-widget";

/**
 * Whether a path is the widget shell — the one document allowed to be framed,
 * because embedding it in customer pages is the product.
 */
export const isEmbeddedWidgetPath = (pathname: string): boolean =>
  pathname === WIDGET_PATH || pathname.startsWith(`${WIDGET_PATH}/`);

/**
 * Normalizes image-origin configuration into CSP host sources.
 *
 * Env values are operator input, so anything that is not an absolute HTTP(S)
 * URL is dropped rather than pasted into a header: a stray `'unsafe-inline'`,
 * a newline, or a comma inside a directive would otherwise let one value
 * rewrite the policy. An origin is reduced to scheme + host + port, so a
 * configured `https://media.example.com/prefix` allows that origin, not just
 * the prefix — CSP host sources have no path component.
 */
export const parseImageOrigins = (
  values: readonly (string | undefined)[]
): readonly string[] => {
  const origins = new Set<string>();
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        const url = new URL(trimmed);
        if (url.protocol === "http:" || url.protocol === "https:") {
          origins.add(url.origin);
        }
      } catch {
        // Not an absolute URL: ignored rather than trusted.
      }
    }
  }
  return [...origins];
};

export interface PageSecurityInput {
  readonly pathname: string;
  /**
   * Whether the hop the app answered on was HTTPS. HSTS is only meaningful
   * over a secure transport, and a development server on `http://localhost`
   * must not pin the host — so this is derived from the request rather than
   * from `NODE_ENV`, which a Worker does not receive by default.
   */
  readonly secureRequest: boolean;
  /** Absolute origins images may load from, beyond the built-in defaults. */
  readonly imageOrigins?: readonly string[];
}

const contentSecurityPolicy = ({
  imageOrigins = [],
  pathname,
}: Pick<PageSecurityInput, "imageOrigins" | "pathname">): string => {
  const imageSources = [
    "'self'",
    "data:",
    "blob:",
    ...DEFAULT_IMAGE_ORIGINS,
    ...imageOrigins,
  ];
  return [
    // The widget is embedded by customer sites; every other document is not
    // framable at all.
    `frame-ancestors ${isEmbeddedWidgetPath(pathname) ? "*" : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `img-src ${[...new Set(imageSources)].join(" ")}`,
  ].join("; ");
};

export const pageSecurityHeaders = ({
  imageOrigins,
  pathname,
  secureRequest,
}: PageSecurityInput) => ({
  "content-security-policy": contentSecurityPolicy({
    imageOrigins,
    pathname,
  }),
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  // `frame-ancestors` is the modern control and `X-Frame-Options` the legacy
  // one; the widget path is the only place the legacy header is omitted,
  // because `DENY` cannot express "only the embed product".
  ...(isEmbeddedWidgetPath(pathname)
    ? undefined
    : { "x-frame-options": "DENY" }),
  ...(secureRequest
    ? { "strict-transport-security": "max-age=63072000; includeSubDomains" }
    : undefined),
});

/**
 * Applies the page policy to a response.
 *
 * The headers are set on the response in place: the SSR document is a stream,
 * and rebuilding the `Response` to attach a header would hand the runtime a new
 * body for statuses that cannot carry one (204/304). If the response's headers
 * are immutable — only possible when a handler forwarded a subrequest's
 * response — the catch rebuilds it, keeping the null body for those statuses.
 */
export const applyPageSecurityHeaders = (
  response: Response,
  input: PageSecurityInput
): Response => {
  const headers = pageSecurityHeaders(input);
  try {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) {
        response.headers.set(name, value);
      }
    }
    return response;
  } catch {
    const merged = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) {
        merged.set(name, value);
      }
    }
    const body =
      response.status === 204 || response.status === 304 ? null : response.body;
    return new Response(body, {
      headers: merged,
      status: response.status,
      statusText: response.statusText,
    });
  }
};
