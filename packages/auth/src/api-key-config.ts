import { apiKey } from "@better-auth/api-key";
import type { ApiKeyConfigurationOptions } from "@better-auth/api-key";
import {
  PUBLIC_API_DEFAULT_SCOPES,
  toPublicApiScopeStatements,
} from "@feeblo/domain/public-api/scopes";

/**
 * Configuration for the api-key plugin, shared by the server composition and
 * its tests so a tested configuration is the configuration that ships.
 *
 * The plugin owns credential material — generation, hashing, expiry, scope
 * storage, and verification. Feeblo owns every authorization decision:
 * `apiKeys.manage` gates who may create a key, the `publicApi` entitlement
 * gates whether the workspace may have one, and the Public API middleware
 * checks scopes per request.
 */
export const publicApiKeyOptions = {
  // Organization-owned, never user-owned: a key must not inherit a member's
  // role or reach, and must not depend on that member staying in the workspace.
  references: "organization",
  apiKeyHeaders: ["x-api-key"],
  defaultPrefix: "fbk_",
  defaultKeyLength: 64,
  requireName: true,
  // Free-form metadata is disabled: it would give customers a place to park
  // personal data beside a credential.
  enableMetadata: false,
  // Keys do not expire. Expiry on a calendar the customer did not choose
  // breaks unattended integrations; revocation is the explicit control, and
  // the dashboard surfaces `lastRequest` per key.
  keyExpiration: {
    defaultExpiresIn: null,
    disableCustomExpiresTime: true,
  },
  startingCharactersConfig: { shouldStore: true, charactersLength: 6 },
  // Per-key limiting runs through the Redis `RateLimitService`, which
  // production already requires to be shared across instances. The plugin's
  // own limiter would add a second implementation and a counter write per
  // request.
  rateLimit: { enabled: false },
  permissions: {
    defaultPermissions: toPublicApiScopeStatements(PUBLIC_API_DEFAULT_SCOPES),
  },
} satisfies ApiKeyConfigurationOptions;

export const publicApiKeyPlugin = apiKey(publicApiKeyOptions);

/**
 * The plugin route that mints a key. The dashboard never calls it directly —
 * the `ApiKeyCreate` RPC does — but any session can POST it, so the plan gate
 * below must cover it.
 */
export const PUBLIC_API_KEY_CREATE_PATH = "/api-key/create";

/**
 * Applies the `publicApi` plan entitlement to API-key creation.
 *
 * The plugin's own endpoints authorize through the organization ACL, which
 * decides *who* may hold a credential but cannot see billing. The dashboard RPC
 * applies `ApiKeyPolicy.canCreate` (the `apiKeys.manage` permission plus the
 * `publicApi` entitlement); without this check an admin or owner on a Free
 * workspace could bypass the plan gate by POSTing the plugin's mounted route
 * directly. `assertPublicApiEntitled` runs the same server-side
 * `EntitlementPolicy.canUsePublicApi` check and is injected so the auth
 * package's tests can wire the real policy without rebuilding the whole auth
 * handler.
 *
 * Only creation is gated: listing and revoking must keep working after a
 * downgrade so a workspace can clean up its keys.
 */
export const enforcePublicApiKeyPlan = async (
  ctx: {
    readonly path: string;
    readonly body?: { readonly organizationId?: unknown } | undefined;
  },
  assertPublicApiEntitled: (organizationId: string) => Promise<void>
): Promise<void> => {
  if (ctx.path !== PUBLIC_API_KEY_CREATE_PATH) {
    return;
  }

  const rawOrganizationId = ctx.body?.["organizationId"];
  // A missing organization id is the endpoint's own validation error; do not
  // turn it into a plan lookup.
  if (rawOrganizationId === undefined) {
    return;
  }

  // The endpoint's body schema coerces the value to a string
  // (`z.coerce.string()`), so the gate must coerce the same way. Skipping a
  // value the endpoint will accept would let `[organizationId]` through as
  // `organizationId`; `String` matches zod's coercion for JSON values.
  const organizationId = String(rawOrganizationId);
  if (organizationId.length === 0) {
    return;
  }

  await assertPublicApiEntitled(organizationId);
};
