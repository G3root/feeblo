import { symmetricDecrypt, symmetricEncrypt } from "@feeblo/utils/crypto";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { WebhookCredentialEncryptionError } from "./webhook-errors";

/** Encrypted at-rest value for a webhook endpoint URL or signing secret. */
export type EncryptedWebhookCredential = string;

/** Stored encrypted credential structure; this schema crosses persistence only as one encrypted JSON value. */
export const WebhookEncryptedCredentialMaterial = Schema.Struct({
  endpointUrl: Schema.String,
  signingKeyring: Schema.Struct({
    current: Schema.String,
    previous: Schema.optionalKey(
      Schema.Struct({
        expiresAt: Schema.DateTimeUtcFromString,
        secret: Schema.String,
      })
    ),
  }),
});
export type WebhookEncryptedCredentialMaterial = Schema.Schema.Type<
  typeof WebhookEncryptedCredentialMaterial
>;

/** Validates the redacted integration encryption key without ever returning its plaintext. */
export const validateWebhookEncryptionKey = (
  encryptionKey: Redacted.Redacted<string>,
  operation: "decrypt" | "encrypt" = "encrypt"
): Effect.Effect<
  Redacted.Redacted<string>,
  WebhookCredentialEncryptionError
> =>
  new TextEncoder().encode(Redacted.value(encryptionKey)).byteLength >= 32
    ? Effect.succeed(encryptionKey)
    : Effect.fail(
        new WebhookCredentialEncryptionError({
          operation,
          reason: "Integration encryption key must contain at least 32 bytes",
        })
      );

/** Encrypts the endpoint and rotation keyring together, so no credential fragment can be persisted in safe metadata. */
export const encryptWebhookCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  credentials: WebhookEncryptedCredentialMaterial
): Effect.Effect<
  EncryptedWebhookCredential,
  WebhookCredentialEncryptionError
> =>
  Effect.gen(function* () {
    const key = yield* validateWebhookEncryptionKey(encryptionKey);
    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(WebhookEncryptedCredentialMaterial)
    )(credentials).pipe(
      Effect.mapError(
        () =>
          new WebhookCredentialEncryptionError({
            operation: "encrypt",
            reason: "Webhook credentials could not be encoded",
          })
      )
    );
    return yield* encryptWebhookCredential(key, Redacted.make(encoded));
  });

/** Decodes encrypted stored credentials at the provider boundary and immediately redacts secret-bearing fields. */
export const decryptWebhookCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedWebhookCredential
): Effect.Effect<
  {
    readonly endpointUrl: Redacted.Redacted<string>;
    readonly signingKeyring: {
      readonly current: Redacted.Redacted<string>;
      readonly previous?: {
        readonly expiresAt: DateTime.Utc;
        readonly secret: Redacted.Redacted<string>;
      };
    };
  },
  WebhookCredentialEncryptionError
> =>
  Effect.flatMap(
    validateWebhookEncryptionKey(encryptionKey, "decrypt"),
    (key) =>
      Effect.flatMap(
        decryptWebhookCredential(key, encryptedCredential),
        (value) =>
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(WebhookEncryptedCredentialMaterial)
          )(Redacted.value(value)).pipe(
            Effect.map((decoded) => ({
              endpointUrl: Redacted.make(decoded.endpointUrl),
              signingKeyring: {
                current: Redacted.make(decoded.signingKeyring.current),
                ...(decoded.signingKeyring.previous === undefined
                  ? {}
                  : {
                      previous: {
                        expiresAt: decoded.signingKeyring.previous.expiresAt,
                        secret: Redacted.make(
                          decoded.signingKeyring.previous.secret
                        ),
                      },
                    }),
              },
            })),
            Effect.mapError(
              () =>
                new WebhookCredentialEncryptionError({
                  operation: "decrypt",
                  reason: "Encrypted webhook credentials are malformed",
                })
            )
          )
      )
  );

/** Encrypts a redacted webhook credential with the redacted integration encryption key. */
export const encryptWebhookCredential = (
  encryptionKey: Redacted.Redacted<string>,
  credential: Redacted.Redacted<string>
): Effect.Effect<
  EncryptedWebhookCredential,
  WebhookCredentialEncryptionError
> =>
  Effect.tryPromise({
    try: () =>
      symmetricEncrypt({
        key: Redacted.value(encryptionKey),
        data: Redacted.value(credential),
      }),
    catch: () =>
      new WebhookCredentialEncryptionError({
        operation: "encrypt",
        reason: "Webhook credential encryption failed",
      }),
  });

/** Decrypts a credential only at the provider boundary and immediately returns it redacted. */
export const decryptWebhookCredential = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedWebhookCredential
): Effect.Effect<Redacted.Redacted<string>, WebhookCredentialEncryptionError> =>
  Effect.mapError(
    Effect.tryPromise({
      try: () =>
        symmetricDecrypt({
          key: Redacted.value(encryptionKey),
          data: encryptedCredential,
        }),
      catch: () =>
        new WebhookCredentialEncryptionError({
          operation: "decrypt",
          reason: "Webhook credential decryption failed",
        }),
    }),
    (error) => error
  ).pipe(Effect.map(Redacted.make));
