// biome-ignore-all lint/suspicious/noBitwiseOperators: IP/CIDR arithmetic requires bitwise operators on BigInt addresses.
// NOTE: this module is imported (transitively, via rpc-group/rate-limit) by
// browser bundles (apps/web rpc-client), so it must not import any node built-ins.
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

const forwardedHeaderIp = (headers: Headers.Headers): string | undefined =>
  normalizeIp(
    Option.getOrUndefined(Headers.get(headers, "cf-connecting-ip"))
  ) ??
  firstForwardedIp(
    Option.getOrUndefined(Headers.get(headers, "x-forwarded-for"))
  ) ??
  normalizeIp(Option.getOrUndefined(Headers.get(headers, "x-real-ip")));

/**
 * Forwarded-client headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`)
 * are trivially spoofable by any client that can reach the origin directly.
 * They must only be trusted when the operator has opted in:
 *
 * - `TRUSTED_PROXY_IPS` — comma-separated IPs/CIDRs of the reverse proxies that
 *   terminate client connections and set these headers.
 * - `TRUST_PROXY_HEADERS=true` — trust the headers regardless of the peer
 *   (use when proxy IPs are dynamic, e.g. a cloud load balancer).
 */
const isProxyTrustEnabled = (): boolean =>
  process.env.TRUST_PROXY_HEADERS === "true";

const trustedProxyCidrs = (): readonly string[] => {
  const raw = process.env.TRUSTED_PROXY_IPS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

type ParsedIp = {
  readonly version: 4 | 6;
  readonly value: bigint;
};

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_REGEX = /^[0-9a-f]{1,4}$/;

const parseIp = (ip: string): ParsedIp | null => {
  const trimmed = ip.trim();

  const ipv4 = IPV4_REGEX.exec(trimmed);
  if (ipv4) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) {
      return null;
    }
    let value = 0n;
    for (const octet of octets) {
      value = (value << 8n) | BigInt(octet);
    }
    return { version: 4, value };
  }

  if (trimmed.includes(":")) {
    const [left, right] = trimmed.toLowerCase().split("::");
    const leftParts = left === undefined || left === "" ? [] : left.split(":");
    const rightParts =
      right === undefined || right === "" ? [] : right.split(":");
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) {
      return null;
    }
    const groups = [
      ...leftParts,
      ...Array.from({ length: missing }, () => "0"),
      ...rightParts,
    ];
    if (groups.length !== 8) {
      return null;
    }
    let value = 0n;
    for (const group of groups) {
      if (!IPV6_GROUP_REGEX.test(group)) {
        return null;
      }
      value = (value << 16n) | BigInt(`0x${group}`);
    }
    return { version: 6, value };
  }

  return null;
};

const ipInCidr = (ip: ParsedIp, cidr: string): boolean => {
  const [range, prefixRaw] = cidr.split("/");
  const rangeIp = range ? parseIp(range) : null;
  if (!rangeIp || rangeIp.version !== ip.version) {
    return false;
  }

  const maxBits = ip.version === 4 ? 32 : 128;
  let bits: number;
  if (prefixRaw === undefined) {
    bits = maxBits;
  } else if (prefixRaw === "") {
    bits = Number.NaN;
  } else {
    bits = Number(prefixRaw);
  }
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) {
    return false;
  }

  const mask =
    bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(maxBits - bits);

  return (ip.value & mask) === (rangeIp.value & mask);
};

/** True when the immediate TCP peer is a trusted reverse proxy. */
export const isTrustedProxy = (peerIp: string): boolean => {
  if (isProxyTrustEnabled()) {
    return true;
  }

  const parsed = parseIp(peerIp);
  if (!parsed) {
    return false;
  }

  return trustedProxyCidrs().some((cidr) => ipInCidr(parsed, cidr));
};

/**
 * Resolves the client IP from request headers alone (no peer info, e.g. the
 * RPC rate-limit middleware). Forwarded headers are only honored when proxy
 * trust is configured; otherwise every caller is indistinguishable and gets
 * the shared "unknown" bucket rather than letting attackers self-assign IPs.
 */
export const getClientIpFromHeaders = (
  headers: Headers.Headers,
  options: { readonly trustForwardedHeaders?: boolean } = {}
): string => {
  const trust = options.trustForwardedHeaders ?? isProxyTrustEnabled();
  if (!trust) {
    return "unknown";
  }
  return forwardedHeaderIp(headers) ?? "unknown";
};

/**
 * Resolves the client IP from the request. The TCP socket peer
 * (`remoteAddress`) cannot be spoofed by the client, so it is preferred; the
 * forwarded headers are only consulted when the peer is a trusted proxy (or
 * when there is no peer information and proxy trust is configured).
 */
export const getClientIpFromRequest = (
  request: HttpServerRequest.HttpServerRequest
): string => {
  const peer = normalizeIp(Option.getOrUndefined(request.remoteAddress));
  if (peer) {
    if (isTrustedProxy(peer)) {
      return forwardedHeaderIp(request.headers) ?? peer;
    }
    return peer;
  }
  return getClientIpFromHeaders(request.headers);
};

export const ClientIpMiddlewareLive = HttpRouter.middleware<{
  provides: ClientIp;
}>()((httpEffect) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
    Effect.provideService(httpEffect, ClientIp, getClientIpFromRequest(request))
  )
).layer;

/**
 * Global variant installed on every route (including the RPC router), so the
 * un-spoofable peer-anchored client IP is available to RPC middleware such as
 * the public rate limiter.
 */
export const ClientIpGlobalMiddlewareLive = HttpRouter.middleware<{
  provides: ClientIp;
}>()(
  (httpEffect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.provideService(
        httpEffect,
        ClientIp,
        getClientIpFromRequest(request)
      )
    ),
  { global: true }
);
