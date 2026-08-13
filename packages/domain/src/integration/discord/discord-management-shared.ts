import { schema } from "@feeblo/db";
import type { DiscordApiFailure } from "@feeblo/integration-discord";
import { decryptDiscordCredentialMaterial } from "@feeblo/integration-discord/credentials";
import { discordProviderKey } from "@feeblo/integration-discord/manifest";
import { and, eq } from "drizzle-orm";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { InternalServerError } from "../../rpc-errors";
import { DiscordIntegrationErrors } from "./errors";

/**
 * Shared helpers for the Discord management services: connection row lookups
 * and management/API error mapping. Owned here because both the connection
 * lifecycle service and the channel service read (and lock) connection rows
 * and translate failures at their boundaries.
 */

/** Maps any non-Discord failure to `InternalServerError`, preserving Discord errors. */
export const mapManagementError =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error: unknown) =>
        Schema.is(DiscordIntegrationErrors)(error)
          ? error
          : new InternalServerError({
              message: `Discord ${operation} failed`,
            })
      )
    );

/** Decrypts a connection's stored credentials, mapping decryption failures to an `InternalServerError`. */
export const decryptConnectionCredentials = (
  config: { readonly encryptionKey: Redacted.Redacted<string> },
  ciphertext: string
): Effect.Effect<
  {
    readonly oauthState?: string;
    readonly userToken?: Redacted.Redacted<string>;
  },
  InternalServerError
> =>
  decryptDiscordCredentialMaterial(config.encryptionKey, ciphertext).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Discord credentials could not be decrypted",
        })
    )
  );

/** Maps a Discord API failure to an `InternalServerError` for one operation. */
export const mapDiscordApiError = (operation: string) =>
  Effect.mapError((error: DiscordApiFailure) => {
    switch (error._tag) {
      case "IntegrationProviderAuthenticationError":
        return new InternalServerError({
          message: `Discord rejected authentication during ${operation}`,
        });
      case "IntegrationProviderRateLimitedError":
        return new InternalServerError({
          message: `Discord rate limited ${operation}`,
        });
      case "IntegrationProviderTemporaryFailure":
        return new InternalServerError({
          message: `Discord temporarily failed during ${operation}`,
        });
      case "IntegrationProviderInvalidConfigurationError":
        return new InternalServerError({
          message: `Discord configuration is invalid during ${operation}`,
        });
      case "IntegrationProviderPermanentRejection":
        return new InternalServerError({
          message: `Discord rejected ${operation}`,
        });
      default:
        // Defensive arm for a future provider failure tag; the union is closed.
        return new InternalServerError({
          message: `Discord ${operation} failed`,
        });
    }
  });

/** Finds a Discord connection by id and organization without locking. */
export const findDiscordConnection = (
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
        eq(schema.integrationConnectionTable.provider, discordProviderKey)
      )
    )
    .limit(1);

/**
 * Row lock for connection updates inside transactions; plain reads use
 * `findDiscordConnection` instead.
 */
export const lockDiscordConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) => findDiscordConnection(db, connectionId, organizationId).for("update");
