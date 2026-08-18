import * as Schema from "effect/Schema";

export {
  IntegrationCredentialEncryptionError as SlackCredentialEncryptionError,
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
  IntegrationRequestSignatureError as SlackSignatureVerificationError,
} from "@feeblo/integration-core";

import type {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";

/** Failure parsing a verified Slack inbound request body into its typed payload. */
export class SlackInboundPayloadError extends Schema.TaggedError<SlackInboundPayloadError>()(
  "SlackInboundPayloadError",
  { reason: Schema.String }
) {}

/** Typed Slack API failure algebra re-exported at the provider boundary. */
export type SlackApiFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection;
