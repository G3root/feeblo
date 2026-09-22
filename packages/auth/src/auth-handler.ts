import type { AuthHandler } from "@feeblo/domain/session-middleware";

import type { Auth as AuthInstance } from "./server";

/**
 * Adapts the better-auth instance to the `Auth` service contract.
 *
 * The seam exists so that `@feeblo/domain` never imports this package — the
 * dependency runs auth → domain, and domain only ever sees `AuthHandler`. The
 * adapter is also where the plugin's call signatures are flattened: better-auth
 * registers overloaded endpoints (one of which demands `asResponse: true`), and
 * a wrapper with one narrow signature is what makes the seam assignable at all.
 *
 * `verifyApiKey` is normalized to the two facts request-time authorization
 * needs — this key is valid, and here is its record — instead of leaking the
 * plugin's four-way result union across the boundary.
 */
export const toAuthHandler = (auth: AuthInstance): AuthHandler => ({
  handler: (request) => auth.handler(request),
  api: {
    getSession: (args) => auth.api.getSession(args),

    createApiKey: (args) => auth.api.createApiKey(args),

    verifyApiKey: async ({ body }) => {
      const result = await auth.api.verifyApiKey({ body: { key: body.key } });
      return result.valid && result.key
        ? { valid: true, key: result.key }
        : { valid: false, key: null };
    },
  },
});
