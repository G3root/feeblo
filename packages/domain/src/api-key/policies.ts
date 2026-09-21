import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";

/**
 * Two independent gates, deliberately composed in one place:
 *
 * - `apiKeys.manage` — who may hold the credential. Admin and owner only,
 *   matching the "Developer — Manage API/SSO keys" row in `docs/permissions.md`.
 * - the `publicApi` plan entitlement — whether the workspace is allowed to use
 *   the Public API at all.
 *
 * Keeping them separate matters at the call sites: listing and revoking keys
 * must stay possible after a downgrade (so the workspace can clean up), while
 * creating one must not.
 */
const makeApiKeyPolicy = Effect.gen(function* () {
  const entitlementPolicy = yield* EntitlementPolicy;

  const canManage = (organizationId: string) =>
    Policy.canPermission(organizationId, "apiKeys.manage");

  const canCreate = (organizationId: string) =>
    Policy.all(
      canManage(organizationId),
      entitlementPolicy.canUsePublicApi(organizationId)
    );

  return { canCreate, canManage };
});

export class ApiKeyPolicy extends Context.Service<ApiKeyPolicy>()(
  "ApiKeyPolicy",
  {
    make: makeApiKeyPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
