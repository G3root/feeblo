import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { PUBLIC_API_SCOPES } from "@feeblo/domain-contracts/public-api-scope";
import type {
  McpAccessTokenRequest,
  McpAccessTokenVerification,
} from "@feeblo/domain/session-middleware";
import { isString } from "@feeblo/utils/runtime-kind";
import { APIError } from "better-auth/api";
import {
  createDpopReplayStore,
  verifyAccessTokenRequest,
} from "better-auth/oauth2";

import type { Auth as AuthInstance } from "./server";

/**
 * The OAuth surface the MCP server presents, and the token check behind it.
 *
 * Everything here is Better Auth's vocabulary — issuer, audience, JWKS,
 * RFC 6750 challenges — and none of it crosses into `@feeblo/domain`, which
 * reaches this module only through the narrow `AuthHandler` seam. See
 * `docs/adr/0024`.
 */

/**
 * The path `/mcp` is mounted at.
 *
 * `PUBLIC_API_MCP_PATH` in `@feeblo/domain` is the authority; this copy keeps
 * the auth server from importing the Public API's whole module graph at
 * startup. `mcp-oauth.test.ts` fails if the two disagree.
 */
export const MCP_RESOURCE_PATH = "/mcp";

/** The access-token claim that names the workspace the grant acts in. */
export const MCP_WORKSPACE_CLAIM = "https://feeblo.com/workspace";

/** The scopes the authorization server advertises and accepts. */
export const MCP_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...PUBLIC_API_SCOPES,
] as const;

/** The protected-resource identifier a token is audience-bound to. */
export const mcpResourceUrl = (apiUrl: string): string =>
  `${apiUrl.replace(/\/+$/, "")}${MCP_RESOURCE_PATH}`;

/** The claims a verified access token carries, as the verifier types them. */
type AccessTokenClaims = Awaited<ReturnType<typeof verifyAccessTokenRequest>>;

/** `HeadersInit` (the provider's challenge shape) as a plain record. */
const toHeaderRecord = (init: HeadersInit | undefined) => {
  const record: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    record[key] = value;
  });
  return record;
};

const stringClaim = (claims: AccessTokenClaims, name: string) => {
  const value = claims[name];
  return isString(value) && value.length > 0 ? value : null;
};

const grantedScopes = (claims: AccessTokenClaims) => {
  const scope = claims.scope;
  return isString(scope) ? scope.split(" ").filter(Boolean) : [];
};

/**
 * Builds the `verifyMcpAccessToken` implementation for one auth instance.
 *
 * The issuer and JWKS URL are the plugin's own (`baseURL`, `/jwks`), so a
 * deployment that moves its API origin moves both together. The challenge is
 * built by the provider, not by hand: it is what carries the RFC 9728
 * `resource_metadata` pointer an MCP client follows to start the flow.
 */
export const makeMcpAccessTokenVerifier =
  (auth: AuthInstance, apiUrl: string) =>
  async ({
    authorizationHeader,
    method,
    url,
    dpopProof,
  }: McpAccessTokenRequest): Promise<McpAccessTokenVerification> => {
    const { adapter, baseURL, internalAdapter } = await auth.$context;
    if (!baseURL) {
      return {
        _tag: "Rejected",
        status: 500,
        message: "The authorization server has no resolved base URL.",
        headers: {},
      };
    }

    const resource = mcpResourceUrl(apiUrl);
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is whatever `verifyAccessTokenRequest` threw, and the provider's challenge builder takes it as `unknown`; naming a narrower type would claim a contract the library does not provide.
    const reject = (error: unknown): McpAccessTokenVerification => {
      const challenge = createResourceServerChallenge(error, resource, {
        challengeScopes: PUBLIC_API_SCOPES,
      });
      if (challenge === undefined) {
        return {
          _tag: "Rejected",
          status: 401,
          message: "The access token could not be verified.",
          headers: {},
        };
      }
      return {
        _tag: "Rejected",
        status: challenge.statusCode,
        message: challenge.message,
        headers: toHeaderRecord(challenge.headers),
      };
    };

    let claims: AccessTokenClaims;
    try {
      claims = await verifyAccessTokenRequest(
        { authorizationHeader, method, url, dpopProofJwt: dpopProof },
        {
          verifyOptions: {
            issuer: baseURL,
            audience: resource,
            requiredClaims: ["azp"],
          },
          jwksUrl: `${baseURL}/jwks`,
          // The default store is process-local, which lets a captured proof be
          // replayed against another instance; the adapter-backed store is the
          // same one `requireMcpAuth` uses.
          dpop: { replayStore: createDpopReplayStore(internalAdapter) },
        }
      );
    } catch (error) {
      return reject(error);
    }

    const subject = stringClaim(claims, "sub");
    const clientId =
      stringClaim(claims, "azp") ?? stringClaim(claims, "client_id");
    const organizationId = stringClaim(claims, MCP_WORKSPACE_CLAIM);

    if (subject === null || clientId === null) {
      return reject(
        new APIError("UNAUTHORIZED", {
          message: "The access token is missing its subject or client.",
        })
      );
    }
    // A grant that names no workspace cannot be turned into a caller, and
    // defaulting to any workspace would be a cross-tenant read. The member
    // re-authorizes after choosing one.
    if (organizationId === null) {
      return {
        _tag: "Rejected",
        status: 403,
        message:
          "This authorization is not bound to a workspace. Reconnect and choose a workspace.",
        headers: {},
      };
    }

    // Consent is a snapshot: a member removed from the workspace keeps a
    // usable token until it expires unless the claim is re-checked. A key dies
    // with the workspace; a grant has to be re-authorized against membership.
    const membership = await adapter.findOne<{ id: string }>({
      model: "member",
      where: [
        { field: "userId", value: subject },
        { field: "organizationId", value: organizationId },
      ],
    });
    if (membership === null) {
      return {
        _tag: "Rejected",
        status: 403,
        message: "You are no longer a member of this workspace.",
        headers: {},
      };
    }

    return {
      _tag: "Verified",
      claims: {
        clientId,
        organizationId,
        scopes: grantedScopes(claims),
        subject,
      },
    };
  };
