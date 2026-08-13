/** biome-ignore-all lint/performance/noBarrelFile: provider error aliases are the public error surface */
import * as Schema from "effect/Schema";

export {
  IntegrationCredentialEncryptionError as GitHubCredentialEncryptionError,
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
  IntegrationRequestSignatureError as GitHubSignatureVerificationError,
} from "@feeblo/integration-core";

import type {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";

export class GitHubInboundPayloadError extends Schema.TaggedErrorClass<GitHubInboundPayloadError>()(
  "GitHubInboundPayloadError",
  { reason: Schema.String }
) {}

export type GitHubApiFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection;
