import {
  IntegrationInboundRejection,
  type IntegrationInboundCapabilityHandler,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpHeaders from "effect/unstable/http/Headers";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Shared plumbing for provider webhook routes (Slack, Discord, GitHub): header
 * extraction, settings-page redirects, and the verified-inbound pipeline that
 * every provider route otherwise copies verbatim.
 */

export const headerValue = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string | undefined =>
  Option.getOrUndefined(HttpHeaders.get(request.headers, name));

/** URL of the dashboard integrations settings page for one provider outcome. */
export const settingsRedirect = (input: {
  readonly appUrl: string;
  readonly provider: "discord" | "github" | "slack";
  readonly status: "connected" | "error";
  readonly message: string;
  readonly organizationId?: string | undefined;
}): string => {
  const base =
    input.organizationId === undefined
      ? `${input.appUrl}/settings/integrations`
      : `${input.appUrl}/${input.organizationId}/settings/integrations`;
  return `${base}?${input.provider}=${input.status}&message=${encodeURIComponent(input.message)}`;
};

/** Maps a domain inbound result to the HTTP response returned to the provider. */
export const inboundHttpResponse = (response: {
  readonly body?: unknown;
  readonly status: number;
}): HttpServerResponse.HttpServerResponse =>
  response.body === undefined
    ? HttpServerResponse.empty({ status: response.status })
    : HttpServerResponse.jsonUnsafe(response.body, { status: response.status });

/**
 * Runs one provider inbound delivery: hands the raw request to the provider
 * handler (which owns signature verification), forwards non-200 verification
 * responses verbatim, decodes the verified body with the route's schema, and
 * delegates to `respond`. A missing handler means the provider is not
 * configured, so the route answers 404.
 */
export const handleVerifiedInbound = <A, I, E, R>(input: {
  readonly handler: IntegrationInboundCapabilityHandler | undefined;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly rawBody: string;
  readonly schema: Schema.Codec<A, I>;
  readonly respond: (
    payload: A
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E | IntegrationInboundRejection,
  R
> => {
  if (input.handler === undefined) {
    return Effect.succeed(
      HttpServerResponse.text("not found", { status: 404 })
    );
  }
  return Effect.flatMap(
    input.handler.handle({ headers: input.headers, rawBody: input.rawBody }),
    (response) => {
      if (response.status !== 200) {
        return Effect.succeed(
          HttpServerResponse.text(String(response.body), {
            status: response.status,
          })
        );
      }
      // The inbound handler already signature-verified the payload; decode
      // the body at the boundary so the domain service receives a typed
      // request. A malformed body is still a client error, not a crash.
      return Effect.flatMap(
        Effect.exit(
          Schema.decodeUnknownEffect(Schema.toType(input.schema))(response.body)
        ),
        (decoded) =>
          Exit.isFailure(decoded)
            ? Effect.logError(decoded.cause).pipe(
                Effect.as(
                  HttpServerResponse.text("invalid inbound payload", {
                    status: 400,
                  })
                )
              )
            : input.respond(decoded.value)
      );
    }
  );
};
