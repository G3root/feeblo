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

const forwardedForAddresses = (headers: Headers.Headers): readonly string[] =>
  (Option.getOrUndefined(Headers.get(headers, "x-forwarded-for")) ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);

/**
 * Forwarded-client headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`)
 * are trivially spoofable by any client that can reach the origin directly, so
 * they are only honored when the immediate TCP peer proves they were written
 * by a trusted intermediary (see `resolveForwardedClientIp`):
 *
 * - `TRUSTED_PROXY_IPS` — comma-separated IPs/CIDRs of the reverse proxies that
 *   terminate client connections and set these headers.
 * - `TRUST_PROXY_HEADERS=true` — treat every peer as a trusted proxy (use when
 *   proxy IPs are dynamic, e.g. a cloud load balancer; requires that clients
 *   cannot reach the origin directly).
 *
 * Proxy contract: each configured proxy must append the address of the peer it
 * saw to `x-forwarded-for` (client-supplied entries then always sit left of the
 * trusted chain and are never reached), or overwrite the header with exactly
 * that peer. A proxy that forwards client-supplied values for its own hop
 * breaks the provenance guarantee and must not be trusted.
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
    let leftParts = left === undefined || left === "" ? [] : left.split(":");
    let rightParts =
      right === undefined || right === "" ? [] : right.split(":");

    // An IPv4 dotted-quad tail (e.g. `::ffff:10.0.0.4`) occupies the final
    // 32 bits and must expand into the last two 16-bit groups.
    const lastGroup =
      rightParts.length > 0 ? rightParts.at(-1) : leftParts.at(-1);
    if (lastGroup?.includes(".")) {
      const quad = parseIp(lastGroup);
      if (!quad || quad.version !== 4) {
        return null;
      }
      const quadGroups = [
        (quad.value >> 16n).toString(16),
        (quad.value & 0xffffn).toString(16),
      ];
      if (rightParts.length > 0) {
        rightParts = [...rightParts.slice(0, -1), ...quadGroups];
      } else {
        leftParts = [...leftParts.slice(0, -1), ...quadGroups];
      }
    }

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

    // Normalize IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) to IPv4 so they
    // match trusted IPv4 CIDRs.
    if (value >> 32n === 0xffffn) {
      return { version: 4, value: value & 0xffffffffn };
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

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
 * `cf-connecting-ip` is only honored when the immediate TCP peer falls inside
 * one of these ranges; any other peer can set the header to an arbitrary
 * value. Keep in sync with Cloudflare's published list.
 */
const CLOUDFLARE_IP_RANGES: readonly string[] = [
  // IPv4
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  // IPv6
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** True when the immediate TCP peer is a Cloudflare edge address. */
const isCloudflarePeer = (peerIp: string): boolean => {
  const parsed = parseIp(peerIp);
  if (!parsed) {
    return false;
  }
  return CLOUDFLARE_IP_RANGES.some((cidr) => ipInCidr(parsed, cidr));
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
 * Resolves the client IP from forwarded headers whose provenance is
 * established by the immediate TCP peer:
 *
 * - `cf-connecting-ip` is honored only when the peer is a Cloudflare edge
 *   address (only Cloudflare sets this header on the connections it
 *   terminates).
 * - `x-forwarded-for` is honored only when the peer is a configured trusted
 *   proxy. The chain is walked right-to-left, skipping only configured trusted
 *   proxy hops; the first remaining address is the client. A malformed chain
 *   carries no client information.
 * - `x-real-ip` is honored only when the peer is a configured trusted proxy
 *   (the single hop that sets it).
 *
 * Returns undefined when no header can be attributed to the peer.
 */
const resolveForwardedClientIp = (
  headers: Headers.Headers,
  peer: string
): string | undefined => {
  const cfConnectingIp = normalizeIp(
    Option.getOrUndefined(Headers.get(headers, "cf-connecting-ip"))
  );
  if (cfConnectingIp && isCloudflarePeer(peer)) {
    return cfConnectingIp;
  }

  if (!isTrustedProxy(peer)) {
    return undefined;
  }

  const forwardedFor = forwardedForAddresses(headers);
  const chainIsValid =
    forwardedFor.length > 0 &&
    forwardedFor.every((address) => parseIp(address) !== null);
  if (chainIsValid) {
    for (let index = forwardedFor.length - 1; index >= 0; index -= 1) {
      const address = forwardedFor[index];
      if (address && !isTrustedProxy(address)) {
        return address;
      }
    }
  }

  return normalizeIp(Option.getOrUndefined(Headers.get(headers, "x-real-ip")));
};

/**
 * Resolves the client IP from request headers and an optional TCP peer. The
 * peer is required to validate the provenance of any forwarded header; without
 * it (e.g. the RPC rate-limit fallback) every forwarded value is
 * indistinguishable from a client-supplied forgery, so the shared "unknown"
 * bucket is returned instead of letting attackers self-assign IPs.
 */
export const getClientIpFromHeaders = (
  headers: Headers.Headers,
  options: { readonly peer?: string } = {}
): string => {
  const peer = normalizeIp(options.peer);
  if (!peer) {
    return "unknown";
  }
  return resolveForwardedClientIp(headers, peer) ?? "unknown";
};

/**
 * Resolves the client IP from the request. The TCP socket peer
 * (`remoteAddress`) cannot be spoofed by the client, so it is preferred; the
 * forwarded headers are only consulted when the peer's provenance establishes
 * them (Cloudflare edge for `cf-connecting-ip`, a configured trusted proxy for
 * `x-forwarded-for` / `x-real-ip`).
 */
export const getClientIpFromRequest = (
  request: HttpServerRequest.HttpServerRequest
): string => {
  const peer = normalizeIp(Option.getOrUndefined(request.remoteAddress));
  if (peer) {
    return resolveForwardedClientIp(request.headers, peer) ?? peer;
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
