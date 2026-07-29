import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

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
): string => {
  const forwardedIp = getClientIpFromHeaders(request.headers);

  return forwardedIp === "unknown"
    ? Option.getOrElse(request.remoteAddress, () => "unknown")
    : forwardedIp;
};
