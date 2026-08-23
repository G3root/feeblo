import { IntegrationOAuthState } from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/**
 * Verified inbound payload contract; the canonical schemas (including the
 * interaction callback vocabulary) live in @feeblo/domain-contracts so the
 * domain inbound service can reference them without depending on this
 * provider package (see docs/adr/0002).
 */
export {
  DiscordApplicationCommandData,
  DiscordApplicationCommandOption,
  DiscordApplicationCommandPayload,
  DiscordInteraction,
  DiscordInteractionMember,
  DiscordInteractionUser,
  DiscordModalComponentValue,
  DiscordModalSubmitData,
  DiscordModalSubmitPayload,
  DiscordPingPayload,
  DiscordResolvedMessage,
  DiscordUnknownInteractionPayload,
  ParsedDiscordInboundRequest,
} from "@feeblo/domain-contracts/discord-inbound";
export type {
  DiscordEmbed,
  DiscordEmbedField,
  DiscordInteractionCallback,
} from "@feeblo/domain-contracts/discord-inbound";

export const DiscordOAuthState = IntegrationOAuthState;
export type DiscordOAuthState = Schema.Schema.Type<typeof DiscordOAuthState>;
