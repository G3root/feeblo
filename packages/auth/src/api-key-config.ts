import { apiKey, API_KEY_ERROR_CODES } from "@better-auth/api-key";
import type { ApiKeyConfigurationOptions } from "@better-auth/api-key";
import {
  PUBLIC_API_DEFAULT_SCOPES,
  toPublicApiScopeStatements,
} from "@feeblo/domain/public-api/scopes";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { hasPermission } from "better-auth/plugins/organization";

import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";

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
 * Rejects key creation before the plan lookup can answer unless the caller is
 * an authenticated member allowed to mint a workspace credential.
 *
 * `assertPublicApiEntitled` answers whether an organization *may* hold a key,
 * not *who* is asking. Running it first would return the plan decision to an
 * unauthenticated or unauthorized caller, revealing whether the workspace has
 * a paid subscription and letting that caller trigger billing lookups. The
 * mounted endpoint performs the same session and ACL checks, but only after
 * this hook has returned, so the gate repeats them here — with the plugin's
 * own error codes — to keep the ordering safe.
 *
 * Server-side `auth.api.*` calls do not carry a request: they are made by
 * trusted in-process code, and the plugin authorizes the explicit `userId`
 * they pass in the endpoint. Only request-bearing callers — every caller that
 * reaches the mounted route through `auth.handler` — are checked here.
 */
const assertApiKeyCreator = async (
  ctx: GenericEndpointContext,
  organizationId: string
): Promise<void> => {
  if (!ctx.request) {
    return;
  }

  const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
  const userId = session?.user.id;
  if (!userId) {
    throw APIError.from(
      "UNAUTHORIZED",
      API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION
    );
  }

  const member = await ctx.context.adapter.findOne<{ role: string }>({
    model: "member",
    where: [
      { field: "userId", value: userId },
      { field: "organizationId", value: organizationId },
    ],
  });
  if (!member) {
    throw APIError.from(
      "FORBIDDEN",
      API_KEY_ERROR_CODES.USER_NOT_MEMBER_OF_ORGANIZATION
    );
  }

  // Mirrors the plugin's `checkOrgApiKeyPermission`: the organization ACL
  // grants `apiKey: ["create"]` to owner and admin, and the creator role
  // bypasses the ACL so an owner can always mint a credential.
  const permitted = await hasPermission(
    {
      role: member.role,
      options: {
        ac: organizationAccessControl,
        roles: ORGANIZATION_ROLES,
        creatorRole: "owner",
      },
      permissions: { apiKey: ["create"] },
      organizationId,
      allowCreatorAllPermissions: true,
    },
    ctx
  );
  if (!permitted) {
    throw APIError.from(
      "FORBIDDEN",
      API_KEY_ERROR_CODES.INSUFFICIENT_API_KEY_PERMISSIONS
    );
  }
};

/**
 * Applies the `publicApi` plan entitlement to API-key creation, after
 * authenticating and authorizing the caller (see `assertApiKeyCreator`) so the
 * plan decision only ever reaches a member who could create the key.
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
  ctx: GenericEndpointContext,
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

  await assertApiKeyCreator(ctx, organizationId);
  await assertPublicApiEntitled(organizationId);
};
