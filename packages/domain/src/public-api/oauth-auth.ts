import {
  PublicApiScopeSchema,
  toPublicApiScopeStatements,
} from "@feeblo/domain-contracts/public-api-scope";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { McpAccessTokenClaims } from "../auth-handler";
import {
  chargePublicApiBudget,
  enforcePublicApiPlan,
  type PublicApiCall,
  type PublicApiKeyBudget,
} from "./api-key-auth";

/**
 * Turns a verified OAuth access token into the caller the MCP tools receive.
 *
 * The token check itself lives in `@feeblo/auth` (`verifyMcpAccessToken`): it
 * owns the issuer, audience, JWKS and the RFC 6750/9728 challenge, and this
 * package must not import Better Auth. What is left here is the part the two
 * credentials share — the plan gate, the budget, and the `PublicApiCall` — so
 * a token and a key are refused by the same code for the same reasons.
 *
 * Scopes are mapped through the Public API's own vocabulary: OIDC scopes the
 * provider issues (`openid`, `profile`, `email`, `offline_access`) are dropped,
 * and a token that holds none of `PUBLIC_API_SCOPES` can call no operation.
 * See `docs/adr/0024`.
 */
const isPublicApiScope = Schema.is(PublicApiScopeSchema);

export const authenticateMcpAccessToken = (
  claims: McpAccessTokenClaims,
  budget: PublicApiKeyBudget
) =>
  Effect.gen(function* () {
    // Per (member, workspace) rather than per token: a client could otherwise
    // mint tokens to multiply its allowance. The limit and window are the ones
    // the published `X-RateLimit-*` contract describes.
    const rateLimit = yield* chargePublicApiBudget(
      `public-api:oauth:${claims.subject}:${claims.organizationId}`,
      budget
    );

    yield* enforcePublicApiPlan(claims.organizationId);

    return {
      credential: {
        _tag: "OAuthGrant",
        clientId: claims.clientId,
        subject: claims.subject,
      },
      organizationId: claims.organizationId,
      rateLimit,
      scopes: toPublicApiScopeStatements(
        claims.scopes.filter(isPublicApiScope)
      ),
    } satisfies PublicApiCall;
  });
