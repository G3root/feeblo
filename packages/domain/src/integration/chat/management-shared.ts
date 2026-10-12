import { schema } from "@feeblo/db";
import type { TIntegrationProviderKey } from "@feeblo/domain-contracts/integration";
import type {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import { and, eq } from "drizzle-orm";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { InternalServerError } from "../../rpc-errors";
import { ChatIntegrationErrors } from "./errors";

/**
 * Shared helpers for a chat provider's management services: connection row
 * lookups and management/API error mapping.
 *
 * Owned here because the connection lifecycle service and the channel service
 * of every chat provider read (and lock) connection rows and translate
 * failures at their boundaries, and the failure algebra is provider-neutral —
 * only the provider key, the display label, and the credential shape vary.
 */

/** Typed provider API failure algebra a chat provider's client reports. */
export type ChatApiFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection;

/**
 * Maps any non-management failure to `InternalServerError`, preserving the
 * shared management error union.
 */
export const mapChatManagementError =
  (label: string) =>
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error) =>
        Schema.is(ChatIntegrationErrors)(error)
          ? error
          : new InternalServerError({
              message: `${label} ${operation} failed`,
            })
      )
    );

/**
 * Decrypts a connection's stored credentials, mapping decryption failures to an
 * `InternalServerError`. The decryption function and the credential shape stay
 * the provider's.
 */
export const decryptChatCredentials = <Material, DecryptError>({
  ciphertext,
  config,
  decrypt,
  label,
}: {
  readonly ciphertext: string;
  readonly config: { readonly encryptionKey: Redacted.Redacted<string> };
  readonly decrypt: (
    encryptionKey: Redacted.Redacted<string>,
    ciphertext: string
  ) => Effect.Effect<Material, DecryptError>;
  readonly label: string;
}): Effect.Effect<Material, InternalServerError> =>
  decrypt(config.encryptionKey, ciphertext).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: `${label} credentials could not be decrypted`,
        })
    )
  );

/** Maps a provider API failure to an `InternalServerError` for one operation. */
export const mapChatApiError = (label: string) => (operation: string) =>
  Effect.mapError((error: ChatApiFailure) => {
    switch (error._tag) {
      case "IntegrationProviderAuthenticationError":
        return new InternalServerError({
          message: `${label} rejected authentication during ${operation}`,
        });
      case "IntegrationProviderRateLimitedError":
        return new InternalServerError({
          message: `${label} rate limited ${operation}`,
        });
      case "IntegrationProviderTemporaryFailure":
        return new InternalServerError({
          message: `${label} temporarily failed during ${operation}`,
        });
      case "IntegrationProviderInvalidConfigurationError":
        return new InternalServerError({
          message: `${label} configuration is invalid during ${operation}`,
        });
      case "IntegrationProviderPermanentRejection":
        return new InternalServerError({
          message: `${label} rejected ${operation}`,
        });
      default:
        // Defensive arm for a future provider failure tag; the union is closed.
        return new InternalServerError({
          message: `${label} ${operation} failed`,
        });
    }
  });

/** Finds one provider connection by id and organization without locking. */
export const findChatConnection = (
  db: PgDrizzle.EffectPgDatabase,
  input: {
    readonly connectionId: string;
    readonly organizationId: string;
    readonly providerKey: TIntegrationProviderKey;
  }
) =>
  db
    .select()
    .from(schema.integrationConnectionTable)
    .where(
      and(
        eq(schema.integrationConnectionTable.id, input.connectionId),
        eq(
          schema.integrationConnectionTable.organizationId,
          input.organizationId
        ),
        eq(schema.integrationConnectionTable.provider, input.providerKey)
      )
    )
    .limit(1);

/**
 * Row lock for connection updates inside transactions; plain reads use
 * `findChatConnection` instead.
 */
export const lockChatConnection = (
  db: PgDrizzle.EffectPgDatabase,
  input: {
    readonly connectionId: string;
    readonly organizationId: string;
    readonly providerKey: TIntegrationProviderKey;
  }
) => findChatConnection(db, input).for("update");
