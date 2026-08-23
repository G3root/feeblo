import { IntegrationOAuthState } from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/**
 * Verified inbound payload contract; the canonical schemas live in
 * @feeblo/domain-contracts so the domain inbound service can reference them
 * without depending on this provider package (see docs/adr/0002).
 */
export {
  ParsedSlackInboundRequest,
  SlackBlockActionsPayload,
  SlackInteractivePayload,
  SlackMessageActionPayload,
  SlackSlashCommandPayload,
  SlackView,
  SlackViewInputValue,
  SlackViewSubmissionPayload,
} from "@feeblo/domain-contracts/slack-inbound";

export const SlackOAuthState = IntegrationOAuthState;
export type SlackOAuthState = Schema.Schema.Type<typeof SlackOAuthState>;

/** Canonical Slack interactive callback ids owned by Feeblo. */
export const SLACK_FEEDBACK_MODAL_CALLBACK_ID = "feeblo_feedback_modal";
export const SLACK_FEEDBACK_MODAL_PRIVATE_METADATA_MAX = 3000;
