import {
  decryptChatCredentials,
  findChatConnection,
  lockChatConnection,
  mapChatApiError,
  mapChatManagementError,
} from "@feeblo/domain/integration/chat/management-shared";
import { decryptSlackCredentialMaterial } from "@feeblo/integration-slack/credentials";
import { slackProviderKey } from "@feeblo/integration-slack/manifest";
import type * as PgDrizzle from "drizzle-orm/effect-postgres";
import type * as Redacted from "effect/Redacted";

/**
 * Slack's bindings for the shared chat management helpers: the provider key,
 * the display label, and the credential shape are the only parts that differ
 * from another chat provider.
 */

/** Maps any non-Slack failure to `InternalServerError`, preserving Slack errors. */
export const mapManagementError = mapChatManagementError("Slack");

/** Maps a Slack API failure to an `InternalServerError` for one operation. */
export const mapSlackApiError = mapChatApiError("Slack");

/** Decrypts a connection's stored credentials, mapping decryption failures to an `InternalServerError`. */
export const decryptConnectionCredentials = (
  config: { readonly encryptionKey: Redacted.Redacted<string> },
  ciphertext: string
) =>
  decryptChatCredentials({
    ciphertext,
    config,
    decrypt: decryptSlackCredentialMaterial,
    label: "Slack",
  });

/** Finds a Slack connection by id and organization without locking. */
export const findSlackConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) =>
  findChatConnection(db, {
    connectionId,
    organizationId,
    providerKey: slackProviderKey,
  });

/**
 * Row lock for connection updates inside transactions; plain reads use
 * `findSlackConnection` instead.
 */
export const lockSlackConnection = (
  db: PgDrizzle.EffectPgDatabase,
  connectionId: string,
  organizationId: string
) =>
  lockChatConnection(db, {
    connectionId,
    organizationId,
    providerKey: slackProviderKey,
  });
