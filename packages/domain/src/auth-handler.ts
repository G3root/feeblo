import type { Role } from "@feeblo/permissions";
import * as Context from "effect/Context";

import type { ApiKeyAuthCreated, ApiKeyAuthRecord } from "./api-key/schema";

/**
 * What `@feeblo/domain` is allowed to know about better-auth, plus the session
 * shape it returns.
 *
 * The dependency runs auth → domain, so the concrete better-auth instance never
 * crosses this boundary; `toAuthHandler` in `packages/auth` adapts it. These
 * live outside `session-middleware.ts` on purpose: code that must never resolve
 * a session still needs the key-management seam, and banning this module
 * outright is a stronger guarantee than naming the session services one by one.
 */

//TODO: infer session later
export type Session = {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly restrictedToOrganizationId?: string | null | undefined;
  };
  readonly session: {
    readonly userId: string;
    readonly token: string;
  };
  readonly organizations: ReadonlyArray<{
    readonly id: string;
  }>;
  readonly memberships: ReadonlyArray<{
    readonly membershipId: string;
    readonly organizationId: string;
    readonly role: Role;
  }>;
};

export type AuthHandler = {
  readonly handler: (request: Request) => Response | Promise<Response>;
  readonly api: {
    readonly getSession: (args: {
      readonly headers: Headers;
    }) => Promise<Session | null>;
    /**
     * Server-side API-key administration, backed by the api-key plugin.
     *
     * Both calls are header-less on purpose. `createApiKey` treats a call
     * carrying a request as a client call and then rejects server-only fields
     * such as `permissions` (the key's scopes), so the acting user is named by
     * `userId`; the plugin still re-checks that user's organization membership
     * and role against the organization ACL. `verifyApiKey` is registered by
     * the plugin as a server-only endpoint that is never mounted on the auth
     * router, so a bearer key cannot be validated by reaching it over HTTP.
     *
     * Listing and revoking are not here: the plugin's endpoints for those are
     * session-bound HTTP endpoints, and the dashboard does those two as
     * org-scoped row operations in `ApiKeyRepository` instead.
     */
    readonly createApiKey: (args: {
      readonly body: {
        readonly organizationId: string;
        readonly userId: string;
        readonly name: string;
        // Mutable arrays on purpose: this is the plugin's statement shape,
        // and a readonly array is not assignable to it.
        readonly permissions?: { readonly [resource: string]: string[] };
      };
    }) => Promise<ApiKeyAuthCreated>;
    readonly verifyApiKey: (args: {
      readonly body: { readonly key: string };
    }) => Promise<
      | { readonly valid: true; readonly key: ApiKeyAuthRecord | null }
      | { readonly valid: false; readonly key: null }
    >;
  };
};

export class Auth extends Context.Service<Auth, AuthHandler>()(
  "@feeblo/api/Auth"
) {}
