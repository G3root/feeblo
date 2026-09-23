import handler from "@tanstack/react-start/server-entry";

import { paraglideMiddleware } from "./paraglide/server.js";

/**
 * The deployment's fetch entry.
 *
 * Paraglide's middleware resolves the request's locale from the cookie and
 * runs the rest of the request inside its `AsyncLocalStorage`, which is what
 * makes `getLocale()` and the `m.*()` messages agree between the server render
 * and the client. The original `request` is handed to the Start handler — the
 * locale strategy has no URL component, so there is nothing to de-localize and
 * the router's own rewrite must see the real path.
 *
 * Subdomain routing is *not* handled here: it is a router `rewrite`
 * (`lib/public-board-rewrite`), so the server and the browser make the same
 * public-to-internal mapping and links keep the visitor's spelling.
 */
export default {
  fetch(request: Request) {
    return paraglideMiddleware(request, () => handler.fetch(request));
  },
};
