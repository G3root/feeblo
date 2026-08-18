import {
  decryptIntegrationCredentialMaterial,
  encryptIntegrationCredentialMaterial,
} from "@feeblo/integration-core";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** Encrypted at-rest value for Discord credentials and OAuth state. */
export type EncryptedDiscordCredential = string;

/**
 * Stored encrypted credential structure; this schema crosses persistence only
 * as one encrypted JSON value.
 *
 * Unlike Slack, the Discord bot token is application-wide and therefore comes
 * from `DISCORD_BOT_TOKEN` configuration (exactly like the Slack signing
 * secret): every guild install of the same bot shares one token, so encrypting
 * it per connection would duplicate a single secret with no isolation benefit.
 * The at-rest material therefore carries only the per-install OAuth artifacts.
 */
export const DiscordEncryptedCredentialMaterial = Schema.Struct({
  /** OAuth state nonce kept while a connection is `connecting`. */
  oauthState: Schema.optionalKey(Schema.String),
  /** Discord user token from the OAuth handshake; unused by V1 and stored for future account linking. */
  userToken: Schema.optionalKey(Schema.String),
});
export type DiscordEncryptedCredentialMaterial = Schema.Schema.Type<
  typeof DiscordEncryptedCredentialMaterial
>;

/** Encrypts the OAuth handshake material together. */
export const encryptDiscordCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  credentials: DiscordEncryptedCredentialMaterial
) =>
  encryptIntegrationCredentialMaterial(
    encryptionKey,
    DiscordEncryptedCredentialMaterial,
    credentials
  );

/** Decodes encrypted stored credentials at the provider boundary and immediately redacts secret-bearing fields. */
export const decryptDiscordCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedDiscordCredential
) =>
  decryptIntegrationCredentialMaterial(
    encryptionKey,
    DiscordEncryptedCredentialMaterial,
    encryptedCredential,
    (decoded) => ({
      ...(decoded.oauthState !== undefined && {
        oauthState: decoded.oauthState,
      }),
      ...(decoded.userToken !== undefined && {
        userToken: Redacted.make(decoded.userToken),
      }),
    })
  );
