import {
  decryptIntegrationCredentialMaterial,
  encryptIntegrationCredentialMaterial,
} from "@feeblo/integration-core";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** Encrypted at-rest value for Slack credentials and OAuth state. */
export type EncryptedSlackCredential = string;

/** Stored encrypted credential structure; this schema crosses persistence only as one encrypted JSON value. */
export const SlackEncryptedCredentialMaterial = Schema.Struct({
  /** Bot access token (`xoxb-...`); absent while the connection is still `connecting`. */
  botToken: Schema.optionalKey(Schema.String),
  /** OAuth state nonce kept while a connection is `connecting`. */
  oauthState: Schema.optionalKey(Schema.String),
  /** Slack user token from the OAuth handshake; unused by V1 and stored for future account linking. */
  userToken: Schema.optionalKey(Schema.String),
  /** Webhook URL Slack provisions for the installed app; unused by V1. */
  incomingWebhookUrl: Schema.optionalKey(Schema.String),
});
export type SlackEncryptedCredentialMaterial = Schema.Schema.Type<
  typeof SlackEncryptedCredentialMaterial
>;

/** Encrypts the bot token and optional OAuth handshake material together. */
export const encryptSlackCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  credentials: SlackEncryptedCredentialMaterial
) =>
  encryptIntegrationCredentialMaterial(
    encryptionKey,
    SlackEncryptedCredentialMaterial,
    credentials
  );

/** Decodes encrypted stored credentials at the provider boundary and immediately redacts secret-bearing fields. */
export const decryptSlackCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedSlackCredential
) =>
  decryptIntegrationCredentialMaterial(
    encryptionKey,
    SlackEncryptedCredentialMaterial,
    encryptedCredential,
    (decoded) => ({
      ...(decoded.botToken !== undefined && { botToken: Redacted.make(decoded.botToken) }),
      ...(decoded.oauthState !== undefined && { oauthState: decoded.oauthState }),
      ...(decoded.userToken !== undefined && { userToken: Redacted.make(decoded.userToken) }),
      ...(decoded.incomingWebhookUrl !== undefined && { incomingWebhookUrl: Redacted.make(decoded.incomingWebhookUrl) }),
    })
  );
