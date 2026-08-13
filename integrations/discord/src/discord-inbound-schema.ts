import { IntegrationOAuthState } from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** Discord `PING` interaction; the endpoint must answer `PONG`. */
export const DiscordPingPayload = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal(1),
});
export type DiscordPingPayload = Schema.Schema.Type<typeof DiscordPingPayload>;

/** Discord user object carried by interactions (the invoking user, never a secret). */
export const DiscordInteractionUser = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type DiscordInteractionUser = Schema.Schema.Type<
  typeof DiscordInteractionUser
>;

/** Discord guild member object carried by guild interactions. */
export const DiscordInteractionMember = Schema.Struct({
  user: DiscordInteractionUser,
  nick: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type DiscordInteractionMember = Schema.Schema.Type<
  typeof DiscordInteractionMember
>;

/** One option of an application command invocation. */
export const DiscordApplicationCommandOption = Schema.Struct({
  name: Schema.String,
  type: Schema.Int,
  value: Schema.optionalKey(Schema.Unknown),
});
export type DiscordApplicationCommandOption = Schema.Schema.Type<
  typeof DiscordApplicationCommandOption
>;

/** Message resolved by a message context menu invocation (`data.resolved.messages`). */
export const DiscordResolvedMessage = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
});
export type DiscordResolvedMessage = Schema.Schema.Type<
  typeof DiscordResolvedMessage
>;

/** Application command data; `type` discriminates slash (1) from context menu (2 = user, 3 = message). */
export const DiscordApplicationCommandData = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Int,
  options: Schema.optionalKey(Schema.Array(DiscordApplicationCommandOption)),
  target_id: Schema.optionalKey(Schema.String),
  resolved: Schema.optionalKey(
    Schema.Struct({
      messages: Schema.optionalKey(
        Schema.Record(Schema.String, DiscordResolvedMessage)
      ),
    })
  ),
});
export type DiscordApplicationCommandData = Schema.Schema.Type<
  typeof DiscordApplicationCommandData
>;

/** Discord `APPLICATION_COMMAND` interaction (`/feeblo` and the "Send to Feeblo" context menu). */
export const DiscordApplicationCommandPayload = Schema.Struct({
  id: Schema.String,
  application_id: Schema.String,
  type: Schema.Literal(2),
  data: DiscordApplicationCommandData,
  guild_id: Schema.String,
  channel_id: Schema.String,
  member: Schema.optionalKey(DiscordInteractionMember),
  user: Schema.optionalKey(DiscordInteractionUser),
  token: Schema.String,
});
export type DiscordApplicationCommandPayload = Schema.Schema.Type<
  typeof DiscordApplicationCommandPayload
>;

/** One text input or string-select value submitted inside a modal label. */
export const DiscordModalComponentValue = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(4),
    custom_id: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(3),
    custom_id: Schema.String,
    values: Schema.Array(Schema.String),
  }),
]);
export type DiscordModalComponentValue = Schema.Schema.Type<
  typeof DiscordModalComponentValue
>;

/** Modal submit data; each type-18 label wraps one submitted component. */
export const DiscordModalSubmitData = Schema.Struct({
  custom_id: Schema.String,
  components: Schema.Array(
    Schema.Struct({
      type: Schema.Literal(18),
      component: DiscordModalComponentValue,
    })
  ),
});
export type DiscordModalSubmitData = Schema.Schema.Type<
  typeof DiscordModalSubmitData
>;

/** Discord `MODAL_SUBMIT` interaction (the feedback form was sent). */
export const DiscordModalSubmitPayload = Schema.Struct({
  id: Schema.String,
  application_id: Schema.String,
  type: Schema.Literal(5),
  data: DiscordModalSubmitData,
  guild_id: Schema.String,
  channel_id: Schema.String,
  member: Schema.optionalKey(DiscordInteractionMember),
  user: Schema.optionalKey(DiscordInteractionUser),
  token: Schema.String,
});
export type DiscordModalSubmitPayload = Schema.Schema.Type<
  typeof DiscordModalSubmitPayload
>;

/**
 * Catch-all for interaction types Feeblo does not handle: `3` (message
 * component) and `4` (application command autocomplete). Feeblo messages
 * carry embeds only and its commands have no autocomplete options, so these
 * never fire in practice; the domain service answers them with a deferred
 * acknowledgment. Kept as a closed literal union so the parsed payload stays
 * a fully discriminated union over `type`.
 */
export const DiscordUnknownInteractionPayload = Schema.Struct({
  type: Schema.Literals([3, 4]),
});
export type DiscordUnknownInteractionPayload = Schema.Schema.Type<
  typeof DiscordUnknownInteractionPayload
>;

/** Every Discord interaction payload Feeblo accepts; order matters, specific types first. */
export const DiscordInteraction = Schema.Union([
  DiscordPingPayload,
  DiscordApplicationCommandPayload,
  DiscordModalSubmitPayload,
  DiscordUnknownInteractionPayload,
]);
export type DiscordInteraction = Schema.Schema.Type<typeof DiscordInteraction>;

/** Provider-inbound request parsed into a discriminated payload for the domain inbound service. */
export const ParsedDiscordInboundRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("ping"),
    payload: DiscordPingPayload,
  }),
  Schema.Struct({
    kind: Schema.Literal("application_command"),
    payload: DiscordApplicationCommandPayload,
  }),
  Schema.Struct({
    kind: Schema.Literal("modal_submit"),
    payload: DiscordModalSubmitPayload,
  }),
  Schema.Struct({
    kind: Schema.Literal("unknown"),
    payload: DiscordUnknownInteractionPayload,
  }),
]);
export type ParsedDiscordInboundRequest = Schema.Schema.Type<
  typeof ParsedDiscordInboundRequest
>;

export const DiscordOAuthState = IntegrationOAuthState;
export type DiscordOAuthState = Schema.Schema.Type<typeof DiscordOAuthState>;
