import { symmetricDecrypt, symmetricEncrypt } from "@feeblo/utils/crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** Failure encrypting or decrypting provider credentials at rest. */
export class IntegrationCredentialEncryptionError extends Schema.TaggedErrorClass<IntegrationCredentialEncryptionError>()(
  "IntegrationCredentialEncryptionError",
  { operation: Schema.Literals(["encrypt", "decrypt"]), reason: Schema.String }
) {}

/** Encrypted at-rest value for provider credentials and OAuth state. */
export type EncryptedIntegrationCredential = string;

/** Validates the redacted integration encryption key without ever returning its plaintext. */
export const validateIntegrationEncryptionKey = (
  encryptionKey: Redacted.Redacted<string>,
  operation: "decrypt" | "encrypt" = "encrypt"
): Effect.Effect<
  Redacted.Redacted<string>,
  IntegrationCredentialEncryptionError
> =>
  new TextEncoder().encode(Redacted.value(encryptionKey)).byteLength >= 32
    ? Effect.succeed(encryptionKey)
    : Effect.fail(
        new IntegrationCredentialEncryptionError({
          operation,
          reason: "Integration encryption key must contain at least 32 bytes",
        })
      );

/** Encrypts a redacted provider credential with the redacted integration encryption key. */
export const encryptIntegrationCredential = (
  encryptionKey: Redacted.Redacted<string>,
  credential: Redacted.Redacted<string>
): Effect.Effect<
  EncryptedIntegrationCredential,
  IntegrationCredentialEncryptionError
> =>
  Effect.tryPromise({
    try: () =>
      symmetricEncrypt({
        key: Redacted.value(encryptionKey),
        data: Redacted.value(credential),
      }),
    catch: () =>
      new IntegrationCredentialEncryptionError({
        operation: "encrypt",
        reason: "Provider credential encryption failed",
      }),
  });

/** Decrypts a credential only at the provider boundary and immediately returns it redacted. */
export const decryptIntegrationCredential = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedIntegrationCredential
): Effect.Effect<
  Redacted.Redacted<string>,
  IntegrationCredentialEncryptionError
> =>
  Effect.tryPromise({
    try: () =>
      symmetricDecrypt({
        key: Redacted.value(encryptionKey),
        data: encryptedCredential,
      }),
    catch: () =>
      new IntegrationCredentialEncryptionError({
        operation: "decrypt",
        reason: "Provider credential decryption failed",
      }),
  }).pipe(Effect.map(Redacted.make));

/**
 * Encrypts a provider-defined credential material schema (JSON-encoded, then
 * encrypted) together. The material shape is owned by each provider; this
 * helper owns the encoding and ciphertext steps.
 */
export const encryptIntegrationCredentialMaterial = <Material, Encoded>(
  encryptionKey: Redacted.Redacted<string>,
  schema: Schema.Codec<Material, Encoded>,
  material: Material
): Effect.Effect<
  EncryptedIntegrationCredential,
  IntegrationCredentialEncryptionError
> =>
  Effect.gen(function* () {
    const key = yield* validateIntegrationEncryptionKey(encryptionKey);
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(schema))(
      material
    ).pipe(
      Effect.mapError(
        () =>
          new IntegrationCredentialEncryptionError({
            operation: "encrypt",
            reason: "Provider credentials could not be encoded",
          })
      )
    );
    return yield* encryptIntegrationCredential(key, Redacted.make(encoded));
  });

/**
 * Decrypts and decodes a provider-defined credential material schema, then
 * applies the provider's redaction policy so secret-bearing fields never
 * leave the provider boundary as plaintext.
 */
export const decryptIntegrationCredentialMaterial = <
  Material,
  Encoded,
  Decoded,
>(
  encryptionKey: Redacted.Redacted<string>,
  schema: Schema.Codec<Material, Encoded>,
  encryptedCredential: EncryptedIntegrationCredential,
  redact: (material: Material) => Decoded
): Effect.Effect<Decoded, IntegrationCredentialEncryptionError> =>
  Effect.flatMap(
    validateIntegrationEncryptionKey(encryptionKey, "decrypt"),
    (key) =>
      Effect.flatMap(
        decryptIntegrationCredential(key, encryptedCredential),
        (value) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
            Redacted.value(value)
          ).pipe(
            Effect.map(redact),
            Effect.mapError(
              () =>
                new IntegrationCredentialEncryptionError({
                  operation: "decrypt",
                  reason: "Encrypted provider credentials are malformed",
                })
            )
          )
      )
  );
