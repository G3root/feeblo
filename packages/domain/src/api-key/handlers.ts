import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  PUBLIC_API_DEFAULT_SCOPES,
  toPublicApiScopeStatements,
  listPublicApiScopes,
} from "../public-api/scopes";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { Auth, CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { ApiKeyPolicy } from "./policies";
import { ApiKeyRepository } from "./repository";
import { ApiKeyRpcs } from "./rpcs";
import type {
  ApiKeyAuthCreated,
  TApiKeyCreate,
  TApiKeyList,
  TApiKeyRevoke,
  TApiKeySummary,
} from "./schema";

/**
 * Shapes the plugin's created-key record into the dashboard's summary. Written
 * out field by field on purpose: the plugin returns its whole table row, and
 * naming each field is what keeps a future column from appearing in the UI by
 * accident.
 */
const toCreatedSummary = (created: ApiKeyAuthCreated): TApiKeySummary => ({
  id: created.id,
  name: created.name,
  start: created.start,
  prefix: created.prefix,
  enabled: created.enabled,
  scopes: listPublicApiScopes(created.permissions),
  createdAt: created.createdAt,
  lastRequest: created.lastRequest,
  expiresAt: created.expiresAt,
});

export const ApiKeyRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* ApiKeyRepository;
  const apiKeyPolicy = yield* ApiKeyPolicy;
  const auth = yield* Auth;

  return {
    ApiKeyCreate: ({ name, organizationId }: TApiKeyCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        // Server-side call, deliberately without request headers: a call that
        // carries a request is treated as a client call, and the plugin then
        // rejects `permissions`, which is where the key's scopes live. The
        // plugin still re-checks that this user is an organization member
        // whose ACL role grants API-key management.
        const created = yield* Effect.tryPromise({
          try: () =>
            auth.api.createApiKey({
              body: {
                organizationId,
                userId: session.user.id,
                name,
                permissions: toPublicApiScopeStatements(
                  PUBLIC_API_DEFAULT_SCOPES
                ),
              },
            }),
          catch: (cause) =>
            new InternalServerError({
              message: "Failed to create API key",
              detail: String(cause),
            }),
        });

        return { key: created.key, summary: toCreatedSummary(created) };
      }).pipe(
        Policy.withPolicy(apiKeyPolicy.canCreate(organizationId)),
        withRemapDbErrors("ApiKey", "create")
      ),

    ApiKeyList: ({ organizationId }: TApiKeyList) =>
      repository
        .listForOrganization({ organizationId })
        .pipe(Policy.withPolicy(apiKeyPolicy.canManage(organizationId))),

    ApiKeyRevoke: ({ organizationId, keyId }: TApiKeyRevoke) =>
      repository
        .revoke({ organizationId, keyId })
        .pipe(Policy.withPolicy(apiKeyPolicy.canManage(organizationId))),
  };
});

export const ApiKeyRpcHandlers = ApiKeyRpcs.toLayer(
  ApiKeyRpcHandlersEffect
).pipe(
  Layer.provide(ApiKeyRepository.layer),
  Layer.provide(
    ApiKeyPolicy.layer.pipe(
      Layer.provide(
        EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
      )
    )
  )
);
