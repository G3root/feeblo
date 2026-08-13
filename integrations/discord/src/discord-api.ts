import {
  IntegrationProviderAuthenticationError,
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderPermanentRejection,
  IntegrationProviderRateLimitedError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { DiscordApiFailure } from "./discord-errors";
import { discordProviderKey } from "./discord-manifest";

/** Discord API base URL. */
export const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

/** Discord OAuth endpoints. */
export const DISCORD_OAUTH_AUTHORIZE_URL =
  "https://discord.com/oauth2/authorize";
export const DISCORD_OAUTH_TOKEN_URL = `${DISCORD_API_BASE_URL}/oauth2/token`;
export const DISCORD_OAUTH_TOKEN_REVOKE_URL = `${DISCORD_API_BASE_URL}/oauth2/token/revoke`;

/** Maximum Discord API request duration. */
export const DISCORD_API_REQUEST_TIMEOUT_MS = 10_000;

/** Discord API error body (`{"code": <int>, "message": <string>}`). */
export const DiscordApiErrorBody = Schema.Struct({
  code: Schema.optionalKey(Schema.Int),
  message: Schema.optionalKey(Schema.String),
  retry_after: Schema.optionalKey(Schema.Number),
});
export type DiscordApiErrorBody = Schema.Schema.Type<
  typeof DiscordApiErrorBody
>;

/** Discord error codes that mean the bot lacks access rather than a bad request. */
const DISCORD_MISSING_ACCESS_CODES = new Set([50_001, 50_013]);

/** Discord error codes that mean the referenced guild/channel no longer exists. */
const DISCORD_NOT_FOUND_CODES = new Set([10_003, 10_004, 10_008]);

/** `oauth2/token` response carrying the installer token and the guild the bot joined. */
export const DiscordOAuthTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.Int,
  scope: Schema.String,
  guild: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      icon: Schema.optionalKey(Schema.NullOr(Schema.String)),
    })
  ),
  user: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      username: Schema.String,
      global_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    })
  ),
});
export type DiscordOAuthTokenResponse = Schema.Schema.Type<
  typeof DiscordOAuthTokenResponse
>;

/** `applications/@me` response used to identify the bot application. */
export const DiscordApplicationResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
});
export type DiscordApplicationResponse = Schema.Schema.Type<
  typeof DiscordApplicationResponse
>;

/** One channel returned by `guilds/{guildId}/channels`. */
export const DiscordChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Int,
  parent_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type DiscordChannel = Schema.Schema.Type<typeof DiscordChannel>;

/** `channels/{id}/messages` response. */
export const DiscordMessageResponse = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  content: Schema.String,
});
export type DiscordMessageResponse = Schema.Schema.Type<
  typeof DiscordMessageResponse
>;

/** One registered guild command returned by the commands API. */
export const DiscordGuildCommand = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Int,
});
export type DiscordGuildCommand = Schema.Schema.Type<
  typeof DiscordGuildCommand
>;

/**
 * Classifies a failed Discord API response into the typed provider failure
 * algebra. Discord answers with real HTTP status codes and a JSON error body
 * carrying an application error code; decode enough of it so transient errors
 * can be retried with the correct backoff.
 */
export const classifyDiscordApiError = (
  response: {
    readonly body?: unknown;
    readonly status?: number;
  },
  context: string
): DiscordApiFailure => {
  const status = response.status;
  const decoded = Schema.decodeUnknownOption(DiscordApiErrorBody)(
    response.body ?? {}
  );
  const errorCode = decoded._tag === "Some" ? decoded.value.code : undefined;
  if (status === 401) {
    return new IntegrationProviderAuthenticationError({
      message: `Discord rejected authentication during ${context}`,
      provider: discordProviderKey,
      httpStatus: status,
    });
  }
  if (status === 403) {
    // Missing Access / Missing Permissions are configuration problems (the
    // bot was not granted the right channel or guild permissions), not
    // authentication failures.
    if (
      errorCode !== undefined &&
      DISCORD_MISSING_ACCESS_CODES.has(errorCode)
    ) {
      return new IntegrationProviderInvalidConfigurationError({
        message: `Discord bot is missing access during ${context}`,
        provider: discordProviderKey,
        httpStatus: status,
      });
    }
    return new IntegrationProviderAuthenticationError({
      message: `Discord rejected authentication during ${context}`,
      provider: discordProviderKey,
      httpStatus: status,
    });
  }
  if (status === 404) {
    if (errorCode !== undefined && DISCORD_NOT_FOUND_CODES.has(errorCode)) {
      return new IntegrationProviderInvalidConfigurationError({
        message: `Discord channel or guild is invalid during ${context}`,
        provider: discordProviderKey,
        httpStatus: status,
      });
    }
    return new IntegrationProviderPermanentRejection({
      message: `Discord rejected ${context}: not found`,
      provider: discordProviderKey,
      httpStatus: status,
    });
  }
  if (status === 429) {
    const retryAfterMs =
      decoded._tag === "Some" && decoded.value.retry_after !== undefined
        ? decoded.value.retry_after * 1000
        : undefined;
    return new IntegrationProviderRateLimitedError({
      message: `Discord rate limited ${context}`,
      provider: discordProviderKey,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      httpStatus: status,
    });
  }
  if (status !== undefined && status >= 500) {
    return new IntegrationProviderTemporaryFailure({
      message: `Discord temporarily failed during ${context}`,
      provider: discordProviderKey,
      httpStatus: status,
    });
  }
  return new IntegrationProviderPermanentRejection({
    message: `Discord rejected ${context}${errorCode === undefined ? "" : `: error ${errorCode}`}`,
    provider: discordProviderKey,
    ...(status === undefined ? {} : { httpStatus: status }),
  });
};

/**
 * Discord API client. Every method takes the bot token and classifies failures
 * into the typed provider failure algebra; response bodies and tokens never
 * appear in failure messages.
 */
export interface DiscordApiClient {
  readonly applicationsMe: (input: {
    readonly botToken: Redacted.Redacted<string>;
  }) => Effect.Effect<DiscordApplicationResponse, DiscordApiFailure>;
  readonly channelsMessagesCreate: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly channelId: string;
    readonly content?: string;
    readonly embeds: readonly unknown[];
  }) => Effect.Effect<DiscordMessageResponse, DiscordApiFailure>;
  readonly guildsChannels: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly guildId: string;
  }) => Effect.Effect<readonly DiscordChannel[], DiscordApiFailure>;
  readonly guildsCommandsBulkOverwrite: (input: {
    readonly applicationId: string;
    readonly botToken: Redacted.Redacted<string>;
    readonly commands: readonly unknown[];
    readonly guildId: string;
  }) => Effect.Effect<readonly DiscordGuildCommand[], DiscordApiFailure>;
  /** Removes the application bot from one Discord guild. */
  readonly guildsLeave: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly guildId: string;
  }) => Effect.Effect<void, DiscordApiFailure>;
  readonly oauth2TokenExchange: (input: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly code: string;
    readonly redirectUri: string;
  }) => Effect.Effect<DiscordOAuthTokenResponse, DiscordApiFailure>;
  readonly oauth2TokenRevoke: (input: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly userToken: Redacted.Redacted<string>;
  }) => Effect.Effect<void, DiscordApiFailure>;
}

/** Creates a Discord API client, using the supplied HTTP client or fetch by default. */
export const makeDiscordApiClient = (
  httpClient?: HttpClient.HttpClient
): DiscordApiClient => {
  const request = Effect.fn("DiscordApi.request")(
    (input: {
      readonly httpRequest: HttpClientRequest.HttpClientRequest;
      readonly context: string;
      readonly responseBody?: "empty" | "json";
    }) =>
      Effect.gen(function* () {
        const execute = HttpClient.execute(input.httpRequest);
        const response = yield* (
          httpClient === undefined
            ? execute.pipe(Effect.provide(FetchHttpClient.layer))
            : execute.pipe(
                Effect.provideService(HttpClient.HttpClient, httpClient)
              )
        ).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderTemporaryFailure({
                message: `Discord request failed during ${input.context}`,
                provider: discordProviderKey,
              })
          )
        );
        const status = response.status;
        if (status < 200 || status >= 300) {
          // Read every error response best-effort so status and Discord's error
          // code participate in the same classification path.
          const bodyResult = yield* Effect.result(response.json);
          const body = Result.isSuccess(bodyResult)
            ? bodyResult.success
            : undefined;
          return yield* classifyDiscordApiError(
            { body, status },
            input.context
          );
        }
        if (input.responseBody === "empty") {
          return undefined;
        }
        return yield* response.json.pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderPermanentRejection({
                message: `Discord returned an unexpected response during ${input.context}`,
                provider: discordProviderKey,
                httpStatus: status,
              })
          )
        );
      }).pipe(
        Effect.timeout(DISCORD_API_REQUEST_TIMEOUT_MS),
        Effect.catchTag(
          "TimeoutError",
          () =>
            new IntegrationProviderTemporaryFailure({
              message: `Discord request failed during ${input.context}`,
              provider: discordProviderKey,
            })
        )
      )
  );

  const jsonRequest = (
    method: "DELETE" | "GET" | "POST" | "PUT",
    path: string,
    {
      body,
      botToken,
    }: {
      readonly body?: unknown;
      readonly botToken?: Redacted.Redacted<string>;
    },
    context: string
  ): Effect.Effect<unknown, DiscordApiFailure> =>
    Effect.gen(function* () {
      const url = `${DISCORD_API_BASE_URL}${path}`;
      let httpRequest = HttpClientRequest.make(method)(url);
      if (botToken !== undefined) {
        httpRequest = HttpClientRequest.setHeader(
          httpRequest,
          "authorization",
          `Bot ${Redacted.value(botToken)}`
        );
      }
      if (body !== undefined) {
        httpRequest = yield* HttpClientRequest.bodyJson(httpRequest, body).pipe(
          Effect.mapError(
            () =>
              new IntegrationProviderPermanentRejection({
                message: `Discord ${context} request could not be encoded`,
                provider: discordProviderKey,
              })
          )
        );
      }
      return yield* request({ httpRequest, context });
    });

  const decodeResponse =
    <S extends Schema.Constraint>(schema: S, context: string) =>
    (
      effect: Effect.Effect<unknown, DiscordApiFailure>
    ): Effect.Effect<S["Type"], DiscordApiFailure, S["DecodingServices"]> =>
      effect.pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
              () =>
                new IntegrationProviderPermanentRejection({
                  message: `Discord ${context} response was invalid`,
                  provider: discordProviderKey,
                })
            )
          )
        )
      );

  const formRequest = (
    url: string,
    body: Record<string, string>,
    context: string
  ): Effect.Effect<unknown, DiscordApiFailure> =>
    request({
      httpRequest: HttpClientRequest.post(url, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }).pipe(HttpClientRequest.bodyUrlParams(body)),
      context,
    });

  return {
    applicationsMe: ({ botToken }) =>
      decodeResponse(
        DiscordApplicationResponse,
        "applications.@me"
      )(
        jsonRequest(
          "GET",
          "/applications/@me",
          { botToken },
          "applications.@me"
        )
      ),
    channelsMessagesCreate: ({ botToken, channelId, content, embeds }) =>
      decodeResponse(
        DiscordMessageResponse,
        "channels.messages.create"
      )(
        jsonRequest(
          "POST",
          `/channels/${channelId}/messages`,
          {
            body: {
              ...(content === undefined ? {} : { content }),
              embeds,
            },
            botToken,
          },
          "channels.messages.create"
        )
      ),
    guildsChannels: ({ botToken, guildId }) =>
      decodeResponse(
        Schema.Array(DiscordChannel),
        "guilds.channels"
      )(
        jsonRequest(
          "GET",
          `/guilds/${guildId}/channels`,
          { botToken },
          "guilds.channels"
        )
      ),
    guildsCommandsBulkOverwrite: ({
      applicationId,
      botToken,
      commands,
      guildId,
    }) =>
      decodeResponse(
        Schema.Array(DiscordGuildCommand),
        "guilds.commands.bulkOverwrite"
      )(
        jsonRequest(
          "PUT",
          `/applications/${applicationId}/guilds/${guildId}/commands`,
          { body: commands, botToken },
          "guilds.commands.bulkOverwrite"
        )
      ),
    guildsLeave: ({ botToken, guildId }) =>
      request({
        httpRequest: HttpClientRequest.make("DELETE")(
          `${DISCORD_API_BASE_URL}/users/@me/guilds/${guildId}`
        ).pipe(
          HttpClientRequest.setHeader(
            "authorization",
            `Bot ${Redacted.value(botToken)}`
          )
        ),
        context: "guilds.leave",
        responseBody: "empty",
      }).pipe(Effect.as(undefined)),
    oauth2TokenExchange: ({ clientId, clientSecret, code, redirectUri }) =>
      decodeResponse(
        DiscordOAuthTokenResponse,
        "oauth2.token"
      )(
        formRequest(
          DISCORD_OAUTH_TOKEN_URL,
          {
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          },
          "oauth2.token"
        )
      ),
    oauth2TokenRevoke: ({ clientId, clientSecret, userToken }) =>
      request({
        httpRequest: HttpClientRequest.post(DISCORD_OAUTH_TOKEN_REVOKE_URL, {
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${Buffer.from(
              `${clientId}:${Redacted.value(clientSecret)}`
            ).toString("base64")}`,
          },
        }).pipe(
          HttpClientRequest.bodyUrlParams({
            token: Redacted.value(userToken),
          })
        ),
        context: "oauth2.token.revoke",
        responseBody: "empty",
      }).pipe(Effect.as(undefined)),
  };
};
