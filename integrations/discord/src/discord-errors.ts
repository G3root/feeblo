import * as Schema from "effect/Schema";

export {
  IntegrationCredentialEncryptionError as DiscordCredentialEncryptionError,
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
  IntegrationRequestSignatureError as DiscordSignatureVerificationError,
} from "@feeblo/integration-core";

import type {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";

/** Failure parsing a verified Discord interaction request body into its typed payload. */
export class DiscordInboundPayloadError extends Schema.TaggedError<DiscordInboundPayloadError>()(
  "DiscordInboundPayloadError",
  { reason: Schema.String }
) {}

/** Typed Discord API failure algebra re-exported at the provider boundary. */
export type DiscordApiFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection;
