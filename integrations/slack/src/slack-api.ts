import {
  IntegrationProviderAuthenticationError,
  IntegrationProviderChannelAlreadyJoinedError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { SlackApiFailure } from "./slack-errors";
import { slackProviderKey } from "./slack-manifest";

/** Slack Web API base URL. */
export const SLACK_API_BASE_URL = "https://slack.com/api";

/** Slack OAuth endpoints. */
export const SLACK_OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_TOKEN_URL = `${SLACK_API_BASE_URL}/oauth.v2.access`;

/** Generic Slack API error envelope (`ok: false`). */
export const SlackApiErrorEnvelope = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.String,
  response_metadata: Schema.optionalKey(
    Schema.Struct({
      retry_after: Schema.optionalKey(Schema.Int),
    })
  ),
});
export type SlackApiErrorEnvelope = Schema.Schema.Type<
  typeof SlackApiErrorEnvelope
>;

/** Successful Slack API envelope (`ok: true`) with open payload fields. */
export const SlackApiSuccessEnvelope = Schema.Struct({
  ok: Schema.Literal(true),
});
export type SlackApiSuccessEnvelope = Schema.Schema.Type<
  typeof SlackApiSuccessEnvelope
>;

/** `auth.test` response used to identify the installed bot and workspace. */
export const SlackAuthTestResponse = Schema.Struct({
  ok: Schema.Literal(true),
  url: Schema.String,
  team: Schema.String,
  user: Schema.String,
  team_id: Schema.String,
  user_id: Schema.String,
  bot_id: Schema.optionalKey(Schema.String),
});
export type SlackAuthTestResponse = Schema.Schema.Type<
  typeof SlackAuthTestResponse
>;

/** `team.info` response carrying the workspace display name. */
export const SlackTeamInfoResponse = Schema.Struct({
  ok: Schema.Literal(true),
  team: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  }),
});
export type SlackTeamInfoResponse = Schema.Schema.Type<
  typeof SlackTeamInfoResponse
>;

/** One channel returned by `conversations.list`. */
export const SlackConversation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  is_member: Schema.optionalKey(Schema.Boolean),
  is_archived: Schema.optionalKey(Schema.Boolean),
});
export type SlackConversation = Schema.Schema.Type<typeof SlackConversation>;

/** `conversations.list` response. */
export const SlackConversationsListResponse = Schema.Struct({
  ok: Schema.Literal(true),
  channels: Schema.Array(SlackConversation),
});
export type SlackConversationsListResponse = Schema.Schema.Type<
  typeof SlackConversationsListResponse
>;

/** `users.info` response carrying the user's display name. */
export const SlackUsersInfoResponse = Schema.Struct({
  ok: Schema.Literal(true),
  user: Schema.Struct({
    id: Schema.String,
    real_name: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.String),
    profile: Schema.optionalKey(
      Schema.Struct({
        display_name: Schema.optionalKey(Schema.String),
        email: Schema.optionalKey(Schema.String),
        real_name: Schema.optionalKey(Schema.String),
      })
    ),
  }),
});
export type SlackUsersInfoResponse = Schema.Schema.Type<
  typeof SlackUsersInfoResponse
>;

/** `oauth.v2.access` response. */
export const SlackOAuthAccessResponse = Schema.Struct({
  ok: Schema.Literal(true),
  app_id: Schema.String,
  team: Schema.Struct({ id: Schema.String, name: Schema.String }),
  bot_user_id: Schema.String,
  access_token: Schema.String,
  token_type: Schema.String,
  authed_user: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      access_token: Schema.optionalKey(Schema.String),
      token_type: Schema.optionalKey(Schema.String),
    })
  ),
  incoming_webhook: Schema.optionalKey(
    Schema.Struct({
      channel_id: Schema.optionalKey(Schema.String),
      channel: Schema.optionalKey(Schema.String),
      configuration_url: Schema.optionalKey(Schema.String),
      url: Schema.optionalKey(Schema.String),
    })
  ),
});
export type SlackOAuthAccessResponse = Schema.Schema.Type<
  typeof SlackOAuthAccessResponse
>;

/** Slack API method result type: `ok: true` plus the method-specific payload. */
export type SlackApiSuccess<Payload> = Payload & { readonly ok: true };

/**
 * Classifies a failed Slack API response into the typed provider failure
 * algebra. `SlackApiErrorEnvelope` fields are decoded so transient errors can
 * be retried with the correct backoff.
 */
export const classifySlackApiError = (
  response: {
    readonly error?: unknown;
    readonly response_metadata?: unknown;
    readonly status?: number;
  },
  context: string
): SlackApiFailure => {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new IntegrationProviderAuthenticationError({
      message: `Slack rejected authentication during ${context}`,
      provider: slackProviderKey,
      ...(status === undefined ? {} : { httpStatus: status }),
    });
  }
  if (status === 429) {
    const decoded = Schema.decodeUnknownOption(SlackApiErrorEnvelope)(response);
    const retryAfterMs =
      decoded._tag === "Some" &&
      decoded.value.response_metadata?.retry_after !== undefined
        ? decoded.value.response_metadata.retry_after * 1000
        : undefined;
    return new IntegrationProviderRateLimitedError({
      message: `Slack rate limited ${context}`,
      provider: slackProviderKey,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...(status === undefined ? {} : { httpStatus: status }),
    });
  }
  if (status !== undefined && status >= 500) {
    return new IntegrationProviderTemporaryFailure({
      message: `Slack temporarily failed during ${context}`,
      provider: slackProviderKey,
      httpStatus: status,
    });
  }
  const decoded = Schema.decodeUnknownOption(SlackApiErrorEnvelope)(response);
  if (decoded._tag === "Some") {
    const errorName = decoded.value.error;
    if (errorName === "invalid_auth" || errorName === "account_inactive") {
      return new IntegrationProviderAuthenticationError({
        message: `Slack token is invalid during ${context}`,
        provider: slackProviderKey,
      });
    }
    if (
      errorName === "not_in_channel" ||
      errorName === "channel_not_found" ||
      errorName === "is_archived" ||
      errorName === "invalid_channel" ||
      errorName === "unknown_channel"
    ) {
      return new IntegrationProviderInvalidConfigurationError({
        message: `Slack channel configuration is invalid during ${context}`,
        provider: slackProviderKey,
      });
    }
    if (errorName === "missing_scope") {
      return new IntegrationProviderInvalidConfigurationError({
        message: `Slack app is missing a required scope during ${context}`,
        provider: slackProviderKey,
      });
    }
    if (errorName === "already_in_channel") {
      return new IntegrationProviderChannelAlreadyJoinedError({
        message: `Slack channel is already joined during ${context}`,
        provider: slackProviderKey,
        ...(status === undefined ? {} : { httpStatus: status }),
      });
    }
    return new IntegrationProviderPermanentRejection({
      message: `Slack rejected ${context}: ${errorName}`,
      provider: slackProviderKey,
      ...(status === undefined ? {} : { httpStatus: status }),
    });
  }
  return new IntegrationProviderPermanentRejection({
    message: `Slack returned an unexpected response during ${context}`,
    provider: slackProviderKey,
    ...(status === undefined ? {} : { httpStatus: status }),
  });
};

/**
 * Slack API client. Every method takes the bot token and classifies failures
 * into the typed provider failure algebra; response bodies and tokens never
 * appear in failure messages.
 */
export interface SlackApiClient {
  readonly authRevoke: (input: {
    readonly botToken: Redacted.Redacted<string>;
  }) => Effect.Effect<SlackApiSuccessEnvelope, SlackApiFailure>;
  readonly authTest: (input: {
    readonly botToken: Redacted.Redacted<string>;
  }) => Effect.Effect<SlackAuthTestResponse, SlackApiFailure>;
  readonly chatPostEphemeral: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly channelId: string;
    readonly text: string;
    readonly userId: string;
  }) => Effect.Effect<SlackApiSuccessEnvelope, SlackApiFailure>;
  readonly chatPostMessage: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly channelId: string;
    readonly blocks: readonly unknown[];
    readonly text: string;
  }) => Effect.Effect<SlackApiSuccessEnvelope, SlackApiFailure>;
  readonly conversationsJoin: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly channelId: string;
  }) => Effect.Effect<SlackApiSuccessEnvelope, SlackApiFailure>;
  readonly conversationsList: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly cursor?: string;
    readonly limit?: number;
    readonly types?: string;
  }) => Effect.Effect<SlackConversationsListResponse, SlackApiFailure>;
  readonly oauthV2Access: (input: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly code: string;
    readonly redirectUri: string;
  }) => Effect.Effect<SlackOAuthAccessResponse, SlackApiFailure>;
  readonly teamInfo: (input: {
    readonly botToken: Redacted.Redacted<string>;
  }) => Effect.Effect<SlackTeamInfoResponse, SlackApiFailure>;
  readonly usersInfo: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly userId: string;
  }) => Effect.Effect<SlackUsersInfoResponse, SlackApiFailure>;
  readonly viewsOpen: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly triggerId: string;
    readonly view: unknown;
  }) => Effect.Effect<SlackApiSuccessEnvelope, SlackApiFailure>;
}

/** Creates the Slack API client backed by the global fetch. */
export const makeSlackApiClient = (
  input: { readonly fetch?: typeof fetch } = {}
): SlackApiClient => {
  const fetchImpl = input.fetch ?? fetch;
  const request = (
    path: string,
    init: RequestInit,
    context: string
  ): Effect.Effect<unknown, SlackApiFailure> =>
    Effect.tryPromise({
      try: () =>
        fetchImpl(`${SLACK_API_BASE_URL}${path}`, init).then(
          async (response) => {
            const status = response.status;
            const body = await response.json().catch(() => undefined);
            if (
              response.ok &&
              body &&
              typeof body === "object" &&
              "ok" in body &&
              body.ok === true
            ) {
              return body;
            }
            const failure = new Error(
              `Slack API request failed with status ${status}`
            );
            Object.assign(failure, body ?? {}, { status });
            throw failure;
          }
        ),
      catch: (error) => {
        if (
          error instanceof IntegrationProviderAuthenticationError ||
          error instanceof IntegrationProviderRateLimitedError ||
          error instanceof IntegrationProviderInvalidConfigurationError ||
          error instanceof IntegrationProviderTemporaryFailure ||
          error instanceof IntegrationProviderPermanentRejection
        ) {
          return error;
        }
        if (typeof error === "object" && error !== null && "status" in error) {
          const { status, ...body } = error;
          return classifySlackApiError(
            {
              ...body,
              ...(typeof status === "number" ? { status } : {}),
            },
            context
          );
        }
        return new IntegrationProviderTemporaryFailure({
          message: `Slack request failed during ${context}`,
          provider: slackProviderKey,
        });
      },
    });

  const jsonRequest = (
    path: string,
    {
      body,
      botToken,
    }: {
      readonly body: Record<string, unknown>;
      readonly botToken?: Redacted.Redacted<string>;
    },
    context: string
  ): Effect.Effect<unknown, SlackApiFailure> =>
    request(
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(botToken === undefined
            ? {}
            : { authorization: `Bearer ${Redacted.value(botToken)}` }),
        },
        body: JSON.stringify(body),
      },
      context
    );

  const formRequest = (
    path: string,
    body: Record<string, string>,
    context: string
  ): Effect.Effect<unknown, SlackApiFailure> =>
    request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      },
      context
    );

  return {
    authRevoke: ({ botToken }) =>
      jsonRequest(
        "/auth.revoke",
        { body: { token: Redacted.value(botToken) }, botToken },
        "auth.revoke"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackApiSuccessEnvelope)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack auth.revoke response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    authTest: ({ botToken }) =>
      jsonRequest(
        "/auth.test",
        { body: { token: Redacted.value(botToken) }, botToken },
        "auth.test"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackAuthTestResponse)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack auth.test response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    chatPostEphemeral: ({ botToken, channelId, text, userId }) =>
      jsonRequest(
        "/chat.postEphemeral",
        { body: { channel: channelId, text, user: userId }, botToken },
        "chat.postEphemeral"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackApiSuccessEnvelope)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack chat.postEphemeral response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    chatPostMessage: ({ botToken, channelId, blocks, text }) =>
      jsonRequest(
        "/chat.postMessage",
        { body: { channel: channelId, blocks, text }, botToken },
        "chat.postMessage"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackApiSuccessEnvelope)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack chat.postMessage response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    conversationsJoin: ({ botToken, channelId }) =>
      jsonRequest(
        "/conversations.join",
        {
          body: {
            token: Redacted.value(botToken),
            channel: channelId,
          },
          botToken,
        },
        "conversations.join"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackApiSuccessEnvelope)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack conversations.join response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        ),
        // Joining a channel the bot is already a member of is a success for
        // our purposes: the caller only cares that the bot ends up in the
        // channel before posting.
        Effect.catchTag("IntegrationProviderChannelAlreadyJoinedError", () =>
          Effect.succeed({ ok: true as const })
        )
      ),
    conversationsList: ({ botToken, cursor, limit, types }) =>
      jsonRequest(
        "/conversations.list",
        {
          body: {
            token: Redacted.value(botToken),
            exclude_archived: true,
            types: types ?? "public_channel,private_channel",
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
          },
          botToken,
        },
        "conversations.list"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackConversationsListResponse)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack conversations.list response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    oauthV2Access: ({ clientId, clientSecret, code, redirectUri }) =>
      formRequest(
        "/oauth.v2.access",
        {
          client_id: clientId,
          client_secret: Redacted.value(clientSecret),
          code,
          redirect_uri: redirectUri,
        },
        "oauth.v2.access"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackOAuthAccessResponse)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack oauth.v2.access response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    teamInfo: ({ botToken }) =>
      jsonRequest(
        "/team.info",
        { body: { token: Redacted.value(botToken) }, botToken },
        "team.info"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackTeamInfoResponse)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack team.info response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    usersInfo: ({ botToken, userId }) =>
      jsonRequest(
        "/users.info",
        { body: { token: Redacted.value(botToken), user: userId }, botToken },
        "users.info"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackUsersInfoResponse)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack users.info response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
    viewsOpen: ({ botToken, triggerId, view }) =>
      jsonRequest(
        "/views.open",
        { body: { trigger_id: triggerId, view }, botToken },
        "views.open"
      ).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(SlackApiSuccessEnvelope)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: "Slack views.open response was invalid",
                  provider: slackProviderKey,
                })
            )
          )
        )
      ),
  };
};
