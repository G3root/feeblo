/** biome-ignore-all lint/performance/noBarrelFile: provider error re-exports are the public entry surface */
import * as Schema from "effect/Schema";

export {
  IntegrationProviderAuthenticationError,
  IntegrationProviderChannelAlreadyJoinedError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";

import type {
  IntegrationProviderAuthenticationError,
  IntegrationProviderChannelAlreadyJoinedError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";

/** Failure encrypting or decrypting Slack credentials at rest. */
export class SlackCredentialEncryptionError extends Schema.TaggedErrorClass<SlackCredentialEncryptionError>()(
  "SlackCredentialEncryptionError",
  { operation: Schema.Literals(["encrypt", "decrypt"]), reason: Schema.String }
) {}

/** Failure verifying a Slack request signature. */
export class SlackSignatureVerificationError extends Schema.TaggedErrorClass<SlackSignatureVerificationError>()(
  "SlackSignatureVerificationError",
  { reason: Schema.String }
) {}

/** Failure parsing a verified Slack inbound request body into its typed payload. */
export class SlackInboundPayloadError extends Schema.TaggedErrorClass<SlackInboundPayloadError>()(
  "SlackInboundPayloadError",
  { reason: Schema.String }
) {}

/** Typed Slack API failure algebra re-exported at the provider boundary. */
export type SlackApiFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection
  | IntegrationProviderChannelAlreadyJoinedError;
