import { currentDb, schema } from "@feeblo/db";
import { and, desc, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { listPublicApiScopes } from "../public-api/scopes";
import { NotFoundError, withRemapDbErrors } from "../rpc-errors";
import type { TApiKeySummary } from "./schema";

interface TListForOrganization {
  organizationId: string;
}

interface TRevoke {
  keyId: string;
  organizationId: string;
}

/**
 * Scope statements as the api-key plugin persists them: a JSON string in
 * `apikey.permissions`. Undecodable values degrade to "no scopes" rather than
 * throwing, because a key with an unreadable scope list is a display problem,
 * never an authorization problem — request-time authorization always reads
 * the verdict from the plugin's own verifier.
 */
const StoredScopeStatements = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String)
);

const decodeScopeStatements = Schema.decodeUnknownOption(
  Schema.fromJsonString(StoredScopeStatements)
);

type ApiKeyRow = typeof schema.apiKeyTable.$inferSelect;

const toSummary = (row: ApiKeyRow): TApiKeySummary => ({
  id: row.id,
  name: row.name,
  start: row.start,
  prefix: row.prefix,
  enabled: row.enabled,
  scopes: listPublicApiScopes(
    Option.getOrUndefined(decodeScopeStatements(row.permissions))
  ),
  createdAt: row.createdAt,
  lastRequest: row.lastRequest,
  expiresAt: row.expiresAt,
});

/**
 * Dashboard-side reads and revocations of Public API keys.
 *
 * Creation and verification stay with the plugin (`Auth.api.createApiKey` /
 * `Auth.api.verifyApiKey`) because hashing, key format, expiry, and scope
 * evaluation are credential logic that must not be reimplemented. Listing and
 * revoking are plain row operations on a table this repository already owns in
 * Drizzle, and the plugin's own endpoints for them are session-bound HTTP
 * endpoints — reaching them from a dashboard RPC would mean reconstructing a
 * session cookie inside a handler for no gain.
 */
const makeApiKeyRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    /** Keys owned by one workspace, newest first. Never returns key material. */
    listForOrganization: ({ organizationId }: TListForOrganization) =>
      db
        .select()
        .from(schema.apiKeyTable)
        .where(eq(schema.apiKeyTable.referenceId, organizationId))
        .orderBy(desc(schema.apiKeyTable.createdAt))
        .pipe(
          Effect.map((rows) => rows.map(toSummary)),
          withRemapDbErrors("ApiKey", "select")
        ),

    /**
     * Deletes one key. Both predicates matter: `id` selects the key, and
     * `reference_id` makes it impossible to revoke another workspace's key
     * with a guessed or leaked id.
     */
    revoke: ({ keyId, organizationId }: TRevoke) =>
      db
        .delete(schema.apiKeyTable)
        .where(
          and(
            eq(schema.apiKeyTable.id, keyId),
            eq(schema.apiKeyTable.referenceId, organizationId)
          )
        )
        .returning({ id: schema.apiKeyTable.id })
        .pipe(
          Effect.flatMap((deleted) =>
            deleted.length === 0
              ? Effect.fail(new NotFoundError({ message: "API key not found" }))
              : Effect.void
          ),
          withRemapDbErrors("ApiKey", "delete")
        ),
  };
});

export class ApiKeyRepository extends Context.Service<ApiKeyRepository>()(
  "ApiKeyRepository",
  {
    make: makeApiKeyRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
