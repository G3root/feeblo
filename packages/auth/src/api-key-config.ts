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
