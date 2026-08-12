import { symmetricDecrypt, symmetricEncrypt } from "@feeblo/utils/crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { SlackCredentialEncryptionError } from "./slack-errors";

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

/** Validates the redacted integration encryption key without ever returning its plaintext. */
export const validateSlackEncryptionKey = (
  encryptionKey: Redacted.Redacted<string>,
  operation: "decrypt" | "encrypt" = "encrypt"
): Effect.Effect<Redacted.Redacted<string>, SlackCredentialEncryptionError> =>
  new TextEncoder().encode(Redacted.value(encryptionKey)).byteLength >= 32
    ? Effect.succeed(encryptionKey)
    : Effect.fail(
        new SlackCredentialEncryptionError({
          operation,
          reason: "Integration encryption key must contain at least 32 bytes",
        })
      );

/** Encrypts the bot token and optional OAuth handshake material together. */
export const encryptSlackCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  credentials: SlackEncryptedCredentialMaterial
): Effect.Effect<EncryptedSlackCredential, SlackCredentialEncryptionError> =>
  Effect.gen(function* () {
    const key = yield* validateSlackEncryptionKey(encryptionKey);
    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(SlackEncryptedCredentialMaterial)
    )(credentials).pipe(
      Effect.mapError(
        () =>
          new SlackCredentialEncryptionError({
            operation: "encrypt",
            reason: "Slack credentials could not be encoded",
          })
      )
    );
    return yield* encryptSlackCredential(key, Redacted.make(encoded));
  });

/** Decodes encrypted stored credentials at the provider boundary and immediately redacts secret-bearing fields. */
export const decryptSlackCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedSlackCredential
): Effect.Effect<
  {
    readonly botToken?: Redacted.Redacted<string>;
    readonly oauthState?: string;
    readonly userToken?: Redacted.Redacted<string>;
    readonly incomingWebhookUrl?: Redacted.Redacted<string>;
  },
  SlackCredentialEncryptionError
> =>
  Effect.flatMap(validateSlackEncryptionKey(encryptionKey, "decrypt"), (key) =>
    Effect.flatMap(decryptSlackCredential(key, encryptedCredential), (value) =>
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(SlackEncryptedCredentialMaterial)
      )(Redacted.value(value)).pipe(
        Effect.map((decoded) => ({
          ...(decoded.botToken === undefined
            ? {}
            : { botToken: Redacted.make(decoded.botToken) }),
          ...(decoded.oauthState === undefined
            ? {}
            : { oauthState: decoded.oauthState }),
          ...(decoded.userToken === undefined
            ? {}
            : { userToken: Redacted.make(decoded.userToken) }),
          ...(decoded.incomingWebhookUrl === undefined
            ? {}
            : {
                incomingWebhookUrl: Redacted.make(decoded.incomingWebhookUrl),
              }),
        })),
        Effect.mapError(
          () =>
            new SlackCredentialEncryptionError({
              operation: "decrypt",
              reason: "Encrypted Slack credentials are malformed",
            })
        )
      )
    )
  );

/** Encrypts a redacted Slack credential with the redacted integration encryption key. */
export const encryptSlackCredential = (
  encryptionKey: Redacted.Redacted<string>,
  credential: Redacted.Redacted<string>
): Effect.Effect<EncryptedSlackCredential, SlackCredentialEncryptionError> =>
  Effect.tryPromise({
    try: () =>
      symmetricEncrypt({
        key: Redacted.value(encryptionKey),
        data: Redacted.value(credential),
      }),
    catch: () =>
      new SlackCredentialEncryptionError({
        operation: "encrypt",
        reason: "Slack credential encryption failed",
      }),
  });

/** Decrypts a credential only at the provider boundary and immediately returns it redacted. */
export const decryptSlackCredential = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedSlackCredential
): Effect.Effect<Redacted.Redacted<string>, SlackCredentialEncryptionError> =>
  Effect.mapError(
    Effect.tryPromise({
      try: () =>
        symmetricDecrypt({
          key: Redacted.value(encryptionKey),
          data: encryptedCredential,
        }),
      catch: () =>
        new SlackCredentialEncryptionError({
          operation: "decrypt",
          reason: "Slack credential decryption failed",
        }),
    }),
    (error) => error
  ).pipe(Effect.map(Redacted.make));
