import * as Schema from "effect/Schema";

/** Slack slash-command payload (`application/x-www-form-urlencoded` decoded). */
export const SlackSlashCommandPayload = Schema.Struct({
  token: Schema.String,
  team_id: Schema.String,
  team_domain: Schema.String,
  channel_id: Schema.String,
  channel_name: Schema.String,
  user_id: Schema.String,
  user_name: Schema.String,
  command: Schema.String,
  text: Schema.String,
  trigger_id: Schema.String,
  response_url: Schema.String,
  api_app_id: Schema.optionalKey(Schema.String),
});
export type SlackSlashCommandPayload = Schema.Schema.Type<
  typeof SlackSlashCommandPayload
>;

/** Slack message-action payload (interactive component). */
export const SlackMessageActionPayload = Schema.Struct({
  type: Schema.Literal("message_action"),
  callback_id: Schema.String,
  team: Schema.Struct({ id: Schema.String, domain: Schema.String }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
  channel: Schema.Struct({ id: Schema.String, name: Schema.String }),
  message: Schema.Struct({
    type: Schema.String,
    text: Schema.String,
    ts: Schema.String,
    user: Schema.optionalKey(Schema.String),
  }),
  trigger_id: Schema.String,
  response_url: Schema.String,
  token: Schema.optionalKey(Schema.String),
  message_ts: Schema.optionalKey(Schema.String),
});
export type SlackMessageActionPayload = Schema.Schema.Type<
  typeof SlackMessageActionPayload
>;

/** One input value from a submitted modal view. */
export const SlackViewInputValue = Schema.Struct({
  type: Schema.String,
  value: Schema.optionalKey(Schema.String),
  selected_option: Schema.optionalKey(
    Schema.Struct({
      value: Schema.String,
      text: Schema.Struct({
        type: Schema.String,
        text: Schema.String,
        emoji: Schema.optionalKey(Schema.Boolean),
      }),
    })
  ),
  selected_options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        value: Schema.String,
        text: Schema.Struct({
          type: Schema.String,
          text: Schema.String,
          emoji: Schema.optionalKey(Schema.Boolean),
        }),
      })
    )
  ),
});
export type SlackViewInputValue = Schema.Schema.Type<
  typeof SlackViewInputValue
>;

/** Modal view definition carried in a `view_submission` payload. */
export const SlackView = Schema.Struct({
  id: Schema.String,
  callback_id: Schema.String,
  private_metadata: Schema.String,
  state: Schema.Struct({
    values: Schema.Record(
      Schema.String,
      Schema.Record(Schema.String, SlackViewInputValue)
    ),
  }),
});
export type SlackView = Schema.Schema.Type<typeof SlackView>;

/** Slack `view_submission` payload. */
export const SlackViewSubmissionPayload = Schema.Struct({
  type: Schema.Literal("view_submission"),
  team: Schema.Struct({ id: Schema.String, domain: Schema.String }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
  view: SlackView,
  response_urls: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type SlackViewSubmissionPayload = Schema.Schema.Type<
  typeof SlackViewSubmissionPayload
>;

/** Slack `block_actions` payload (button clicks inside messages). */
export const SlackBlockActionsPayload = Schema.Struct({
  type: Schema.Literal("block_actions"),
  team: Schema.Struct({ id: Schema.String, domain: Schema.String }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
  actions: Schema.Array(
    Schema.Struct({
      action_id: Schema.String,
      block_id: Schema.String,
      value: Schema.optionalKey(Schema.String),
    })
  ),
  channel: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
  response_url: Schema.optionalKey(Schema.String),
  trigger_id: Schema.optionalKey(Schema.String),
});
export type SlackBlockActionsPayload = Schema.Schema.Type<
  typeof SlackBlockActionsPayload
>;

/** Discriminated union over every interactive payload Feeblo accepts. */
export const SlackInteractivePayload = Schema.Union([
  SlackMessageActionPayload,
  SlackViewSubmissionPayload,
  SlackBlockActionsPayload,
]);
export type SlackInteractivePayload = Schema.Schema.Type<
  typeof SlackInteractivePayload
>;

/** Provider-inbound request parsed into a discriminated payload for the domain inbound service. */
export const ParsedSlackInboundRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("slash_command"),
    payload: SlackSlashCommandPayload,
  }),
  Schema.Struct({
    kind: Schema.Literal("interactive"),
    payload: SlackInteractivePayload,
  }),
]);
export type ParsedSlackInboundRequest = Schema.Schema.Type<
  typeof ParsedSlackInboundRequest
>;
