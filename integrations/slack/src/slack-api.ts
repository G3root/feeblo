import { isObject } from "@feeblo/utils/runtime-kind";
import {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import type { SlackApiFailure } from "./slack-errors";
import { slackProviderKey } from "./slack-manifest";

/** Slack Web API base URL. */
export const SLACK_API_BASE_URL = "https://slack.com/api";

/** Slack OAuth endpoints. */
export const SLACK_OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_OAUTH_TOKEN_URL = `${SLACK_API_BASE_URL}/oauth.v2.access`;

/** Maximum Slack Web API request duration. */
export const SLACK_API_REQUEST_TIMEOUT_MS = 10_000;

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
  is_private: Schema.optionalKey(Schema.Boolean),
  is_archived: Schema.optionalKey(Schema.Boolean),
});
export type SlackConversation = Schema.Schema.Type<typeof SlackConversation>;

/** `conversations.list` response. */
export const SlackConversationsListResponse = Schema.Struct({
  ok: Schema.Literal(true),
  channels: Schema.Array(SlackConversation),
  response_metadata: Schema.optionalKey(
    Schema.Struct({
      next_cursor: Schema.optionalKey(Schema.String),
    })
  ),
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
      ...(status === undefined ? undefined : { httpStatus: status }),
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
      ...(retryAfterMs === undefined ? undefined : { retryAfterMs }),
      ...(status === undefined ? undefined : { httpStatus: status }),
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
    return new IntegrationProviderPermanentRejection({
      message: `Slack rejected ${context}: ${errorName}`,
      provider: slackProviderKey,
      ...(status === undefined ? undefined : { httpStatus: status }),
    });
  }
  return new IntegrationProviderPermanentRejection({
    message: `Slack returned an unexpected response during ${context}`,
    provider: slackProviderKey,
    ...(status === undefined ? undefined : { httpStatus: status }),
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

/** Creates the Slack API client backed by Effect's fetch HTTP client. */
export const makeSlackApiClient = (): SlackApiClient => {
  const request = Effect.fn("SlackApi.request")(function* (input: {
    readonly httpRequest: HttpClientRequest.HttpClientRequest;
    readonly context: string;
  }) {
    const response = yield* HttpClient.execute(input.httpRequest).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.timeout(SLACK_API_REQUEST_TIMEOUT_MS),
      Effect.mapError(
        () =>
          new IntegrationProviderTemporaryFailure({
            message: `Slack request failed during ${input.context}`,
            provider: slackProviderKey,
          })
      )
    );
    const status = response.status;
    // Slack signals rate limiting (429) and transient server errors (5xx)
    // through the HTTP status even when the body is not JSON; classify those
    // from the status alone before reading the body so a non-JSON error page
    // cannot downgrade a retryable failure into a terminal rejection.
    if (status === 429 || (status >= 500 && status < 600)) {
      return yield* classifySlackApiError({ status }, input.context);
    }
    const body = yield* response.json.pipe(
      Effect.mapError(
        () =>
          new IntegrationProviderPermanentRejection({
            message: `Slack returned an unexpected response during ${input.context}`,
            provider: slackProviderKey,
            httpStatus: status,
          })
      )
    );
    // The Slack Web API always answers HTTP 200 and signals failure through
    // the `ok: false` envelope; classify that envelope (and any non-2xx
    // status) into the typed provider failure algebra.
    if (
      isObject(body) &&
      body !== null &&
      "ok" in body &&
      body.ok === true
    ) {
      return body;
    }
    return yield* classifySlackApiError(
      {
        ...(isObject(body) && body),
        status,
      },
      input.context
    );
  });

  const jsonRequest = (
    path: string,
    {
      body,
      botToken,
    }: {
      readonly body: Record<string, string | number | boolean | null | undefined>;
      readonly botToken?: Redacted.Redacted<string>;
    },
    context: string
  ): Effect.Effect<unknown, SlackApiFailure> =>
    Effect.gen(function* () {
      let httpRequest = HttpClientRequest.post(`${SLACK_API_BASE_URL}${path}`, {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
      if (botToken !== undefined) {
        httpRequest = HttpClientRequest.bearerToken(httpRequest, botToken);
      }
      httpRequest = yield* HttpClientRequest.bodyJson(httpRequest, body).pipe(
        Effect.mapError(
          () =>
            new IntegrationProviderPermanentRejection({
              message: `Slack ${context} request could not be encoded`,
              provider: slackProviderKey,
            })
        )
      );
      return yield* request({ httpRequest, context });
    });

  const formRequest = (
    path: string,
    body: Record<string, string>,
    context: string
  ): Effect.Effect<unknown, SlackApiFailure> =>
    request({
      httpRequest: HttpClientRequest.post(`${SLACK_API_BASE_URL}${path}`, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }).pipe(HttpClientRequest.bodyUrlParams(body)),
      context,
    });

  const decodeResponse =
    <S extends Schema.Constraint>(schema: S, context: string) =>
    (
      effect: Effect.Effect<unknown, SlackApiFailure>
    ): Effect.Effect<S["Type"], SlackApiFailure, S["DecodingServices"]> =>
      effect.pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: `Slack ${context} response was invalid`,
                  provider: slackProviderKey,
                })
            )
          )
        )
      );

  return {
    authRevoke: ({ botToken }) =>
      decodeResponse(
        SlackApiSuccessEnvelope,
        "auth.revoke"
      )(
        jsonRequest(
          "/auth.revoke",
          { body: { token: Redacted.value(botToken) }, botToken },
          "auth.revoke"
        )
      ),
    authTest: ({ botToken }) =>
      decodeResponse(
        SlackAuthTestResponse,
        "auth.test"
      )(
        jsonRequest(
          "/auth.test",
          { body: { token: Redacted.value(botToken) }, botToken },
          "auth.test"
        )
      ),
    chatPostEphemeral: ({ botToken, channelId, text, userId }) =>
      decodeResponse(
        SlackApiSuccessEnvelope,
        "chat.postEphemeral"
      )(
        jsonRequest(
          "/chat.postEphemeral",
          { body: { channel: channelId, text, user: userId }, botToken },
          "chat.postEphemeral"
        )
      ),
    chatPostMessage: ({ botToken, channelId, blocks, text }) =>
      decodeResponse(
        SlackApiSuccessEnvelope,
        "chat.postMessage"
      )(
        jsonRequest(
          "/chat.postMessage",
          { body: { channel: channelId, blocks, text }, botToken },
          "chat.postMessage"
        )
      ),
    conversationsJoin: ({ botToken, channelId }) =>
      decodeResponse(
        SlackApiSuccessEnvelope,
        "conversations.join"
      )(
        jsonRequest(
          "/conversations.join",
          {
            body: { token: Redacted.value(botToken), channel: channelId },
            botToken,
          },
          "conversations.join"
        )
      ),
    conversationsList: ({ botToken, cursor, limit, types }) =>
      decodeResponse(
        SlackConversationsListResponse,
        "conversations.list"
      )(
        jsonRequest(
          "/conversations.list",
          {
            body: {
              token: Redacted.value(botToken),
              exclude_archived: true,
              types: types ?? "public_channel,private_channel",
              ...(cursor === undefined ? undefined : { cursor }),
              ...(limit === undefined ? undefined : { limit }),
            },
            botToken,
          },
          "conversations.list"
        )
      ),
    oauthV2Access: ({ clientId, clientSecret, code, redirectUri }) =>
      decodeResponse(
        SlackOAuthAccessResponse,
        "oauth.v2.access"
      )(
        formRequest(
          "/oauth.v2.access",
          {
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            code,
            redirect_uri: redirectUri,
          },
          "oauth.v2.access"
        )
      ),
    teamInfo: ({ botToken }) =>
      decodeResponse(
        SlackTeamInfoResponse,
        "team.info"
      )(
        jsonRequest(
          "/team.info",
          { body: { token: Redacted.value(botToken) }, botToken },
          "team.info"
        )
      ),
    usersInfo: ({ botToken, userId }) =>
      decodeResponse(
        SlackUsersInfoResponse,
        "users.info"
      )(
        jsonRequest(
          "/users.info",
          { body: { token: Redacted.value(botToken), user: userId }, botToken },
          "users.info"
        )
      ),
    viewsOpen: ({ botToken, triggerId, view }) =>
      decodeResponse(
        SlackApiSuccessEnvelope,
        "views.open"
      )(
        jsonRequest(
          "/views.open",
          { body: { trigger_id: triggerId, view }, botToken },
          "views.open"
        )
      ),
  };
};
