import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

export class ClientIp extends Context.Service<ClientIp, string>()(
  "@feeblo/domain/ClientIp"
) {}

const normalizeIp = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const firstForwardedIp = (value: string | undefined): string | undefined =>
  normalizeIp(value?.split(",", 1)[0]);

export const getClientIpFromHeaders = (headers: Headers.Headers): string =>
  normalizeIp(
    Option.getOrUndefined(Headers.get(headers, "cf-connecting-ip"))
  ) ??
  firstForwardedIp(
    Option.getOrUndefined(Headers.get(headers, "x-forwarded-for"))
  ) ??
  normalizeIp(Option.getOrUndefined(Headers.get(headers, "x-real-ip"))) ??
  "unknown";

export const getClientIpFromRequest = (
  request: HttpServerRequest.HttpServerRequest
): string =>
  normalizeIp(Option.getOrUndefined(request.remoteAddress)) ??
  getClientIpFromHeaders(request.headers);

export const ClientIpMiddlewareLive = HttpRouter.middleware<{
  provides: ClientIp;
}>()(
  (httpEffect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.provideService(
        httpEffect,
        ClientIp,
        getClientIpFromRequest(request)
      )
    )
).layer;
