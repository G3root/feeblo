import {
  decryptIntegrationCredentialMaterial,
  encryptIntegrationCredentialMaterial,
} from "@feeblo/integration-core";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** One encrypted persistence value for GitHub App connection material; no secret belongs in route JSON. */
export type EncryptedGitHubCredential = string;

export const GitHubEncryptedCredentialMaterial = Schema.Struct({
  /** GitHub App installation identity is encrypted with its pending setup state. */
  installationId: Schema.optionalKey(Schema.NonEmptyString),
  /** One-time state generated before redirecting an administrator to GitHub. */
  installationState: Schema.optionalKey(Schema.NonEmptyString),
});
export type GitHubEncryptedCredentialMaterial = Schema.Schema.Type<
  typeof GitHubEncryptedCredentialMaterial
>;

export const encryptGitHubCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  credentials: GitHubEncryptedCredentialMaterial
) =>
  encryptIntegrationCredentialMaterial(
    encryptionKey,
    GitHubEncryptedCredentialMaterial,
    credentials
  );

/** Decryption returns only durable installation state; access tokens are never persisted. */
export const decryptGitHubCredentialMaterial = (
  encryptionKey: Redacted.Redacted<string>,
  encryptedCredential: EncryptedGitHubCredential
) =>
  decryptIntegrationCredentialMaterial(
    encryptionKey,
    GitHubEncryptedCredentialMaterial,
    encryptedCredential,
    (decoded) => decoded
  );
