import {
  decryptChatCredentials,
  findChatConnection,
  lockChatConnection,
  mapChatApiError,
  mapChatManagementError,
} from "@feeblo/domain/integration/chat/management-shared";
import { decryptDiscordCredentialMaterial } from "@feeblo/integration-discord/credentials";
import { discordProviderKey } from "@feeblo/integration-discord/manifest";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import type * as Redacted from "effect/Redacted";

/**
 * Discord's bindings for the shared chat management helpers: the provider key,
 * the display label, and the credential shape are the only parts that differ
 * from another chat provider.
 */

/** Maps any non-Discord failure to `InternalServerError`, preserving Discord errors. */
export const mapManagementError = mapChatManagementError("Discord");

/** Maps a Discord API failure to an `InternalServerError` for one operation. */
export const mapDiscordApiError = mapChatApiError("Discord");

/** Decrypts a connection's stored credentials, mapping decryption failures to an `InternalServerError`. */
export const decryptConnectionCredentials = (
  config: { readonly encryptionKey: Redacted.Redacted<string> },
  ciphertext: string
) =>
  decryptChatCredentials({
    ciphertext,
    config,
    decrypt: decryptDiscordCredentialMaterial,
    label: "Discord",
  });

/** Finds a Discord connection by id and organization without locking. */
export const findDiscordConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) =>
  findChatConnection(db, {
    connectionId,
    organizationId,
    providerKey: discordProviderKey,
  });

/**
 * Row lock for connection updates inside transactions; plain reads use
 * `findDiscordConnection` instead.
 */
export const lockDiscordConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) =>
  lockChatConnection(db, {
    connectionId,
    organizationId,
    providerKey: discordProviderKey,
  });
