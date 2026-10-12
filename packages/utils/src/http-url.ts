import * as Schema from "effect/Schema";

/**
 * True when a string parses as an absolute `http:` or `https:` URL.
 *
 * The render-time counterpart of {@link HttpUrl}, for callers that already
 * hold a URL object or a stored string and only need the guard.
 */
export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * A URL that may be rendered as a link.
 *
 * `Schema.URLFromString` accepts every scheme `new URL` does — including
 * `javascript:` and `data:` — so a provider-supplied `remoteUrl` validated
 * with it can execute in the dashboard's origin when clicked. Provider data is
 * first-party today, but the stored value is one a customer's browser
 * dereferences, so the scheme is constrained where it crosses the boundary.
 */
export const HttpUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    (url: URL) => url.protocol === "http:" || url.protocol === "https:",
    { message: "URL must use http or https" }
  )
);
