import { schema } from "@feeblo/db";
import { SlackIntegrationErrors } from "@feeblo/domain/integration/slack/errors";
import { InternalServerError } from "@feeblo/domain/rpc-errors";
import type { SlackApiFailure } from "@feeblo/integration-slack";
import { decryptSlackCredentialMaterial } from "@feeblo/integration-slack/credentials";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import { and, eq } from "drizzle-orm";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/**
 * Shared helpers for the Slack management services: connection row lookups and
 * management/API error mapping. Owned here because both the connection
 * lifecycle service and the channel service read (and lock) connection rows and
 * translate failures at their boundaries.
 */

/** Maps any non-Slack failure to `InternalServerError`, preserving Slack errors. */
export const mapManagementError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error) =>
        Schema.is(SlackIntegrationErrors)(error)
          ? error
          : new InternalServerError({
              message: `Slack ${operation} failed`,
            })
      )
    );

/** Decrypts a connection's stored credentials, mapping decryption failures to an `InternalServerError`. */
export const decryptConnectionCredentials = (
  config: { readonly encryptionKey: Redacted.Redacted<string> },
  ciphertext: string
): Effect.Effect<
  {
    readonly botToken?: Redacted.Redacted<string>;
    readonly oauthState?: string;
  },
  InternalServerError
> =>
  decryptSlackCredentialMaterial(config.encryptionKey, ciphertext).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Slack credentials could not be decrypted",
        })
    )
  );

/** Maps a Slack API failure to an `InternalServerError` for one operation. */
export const mapSlackApiError = (operation: string) =>
  Effect.mapError((error: SlackApiFailure) => {
    switch (error._tag) {
      case "IntegrationProviderAuthenticationError":
        return new InternalServerError({
          message: `Slack rejected authentication during ${operation}`,
        });
      case "IntegrationProviderRateLimitedError":
        return new InternalServerError({
          message: `Slack rate limited ${operation}`,
        });
      case "IntegrationProviderTemporaryFailure":
        return new InternalServerError({
          message: `Slack temporarily failed during ${operation}`,
        });
      case "IntegrationProviderInvalidConfigurationError":
        return new InternalServerError({
          message: `Slack configuration is invalid during ${operation}`,
        });
      case "IntegrationProviderPermanentRejection":
        return new InternalServerError({
          message: `Slack rejected ${operation}`,
        });
      default:
        // Defensive arm for a future provider failure tag; the union is closed.
        return new InternalServerError({
          message: `Slack ${operation} failed`,
        });
    }
  });

/** Finds a Slack connection by id and organization without locking. */
export const findSlackConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) =>
  db
    .select()
    .from(schema.integrationConnectionTable)
    .where(
      and(
        eq(schema.integrationConnectionTable.id, connectionId),
        eq(schema.integrationConnectionTable.organizationId, organizationId),
        eq(schema.integrationConnectionTable.provider, slackProviderKey)
      )
    )
    .limit(1);

/**
 * Row lock for connection updates inside transactions; plain reads use
 * `findSlackConnection` instead.
 */
export const lockSlackConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) => findSlackConnection(db, connectionId, organizationId).for("update");
