// NOTE: this module is imported by browser bundles, so it must not import any
// Node.js built-ins or read process.env.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import ipaddr from "ipaddr.js";

/** The peer-anchored client IP available during an HTTP request. */
export class ClientIp extends Context.Service<ClientIp, ClientIpValue>()(
  "@feeblo/domain/ClientIp"
) {}

type ParsedIpAddress = {
  readonly address: ipaddr.IPv4 | ipaddr.IPv6;
  readonly text: string;
};

type ParsedIpCidr = {
  readonly address: ParsedIpAddress;
  readonly prefixLength: number;
};

const CIDR_PREFIX_PATTERN = /^\d+$/;

/** A syntactically valid, canonical IPv4 or IPv6 address. */
export type ClientIpAddress = {
  readonly _tag: "ClientIpAddress";
  readonly address: string;
};

/** Explicitly represents a request whose network peer cannot be determined. */
export type ClientIpUnavailable = {
  readonly _tag: "ClientIpUnavailable";
};

/** Client identity used to partition public rate-limit buckets. */
export type ClientIpValue = ClientIpAddress | ClientIpUnavailable;

/** Shared value for requests whose network peer cannot be determined. */
export const ClientIpUnavailable: ClientIpUnavailable = {
  _tag: "ClientIpUnavailable",
};

/** Parsed proxy trust policy, constructed once from server configuration. */
export type ClientIpProxyTrust = {
  /** Identifies this value as validated client IP proxy trust configuration. */
  readonly _tag: "ClientIpProxyTrust";
  /** Trusts the entire forwarding chain; safe only when the server is unreachable except through controlled proxies. */
  readonly trustAllHeaders: boolean;
  /** Immediate proxy peers and forwarding hops allowed to supply client IP headers. */
  readonly trustedProxyCidrs: readonly ParsedIpCidr[];
};

/** Raw proxy trust values read at the server composition root. */
export type ClientIpProxyTrustInput = {
  /** Whether every immediate peer and forwarded hop is trusted. */
  readonly trustAllHeaders: boolean;
  /** Exact proxy addresses or CIDR ranges, as comma-separated configuration entries. */
  readonly trustedProxyCidrs: readonly string[];
};

/** Configuration error produced when a trusted proxy IP or CIDR is malformed. */
export type InvalidClientIpProxyTrustConfiguration = {
  /** Identifies malformed client IP proxy trust configuration. */
  readonly _tag: "InvalidClientIpProxyTrustConfiguration";
  /** Unmodified configuration entry that could not be parsed as an IP address or CIDR. */
  readonly entry: string;
};

const parseIpAddress = (input: string): ParsedIpAddress | undefined => {
  const text = input.trim();
  if (!ipaddr.isValid(text)) {
    return undefined;
  }
  const parsed = ipaddr.parse(text);
  const address =
    parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
      ? parsed.toIPv4Address()
      : parsed;
  return { address, text: address.toString() };
};

const parseIpCidr = (input: string): ParsedIpCidr | undefined => {
  const trimmed = input.trim();
  const cidrParts = trimmed.split("/");
  if (cidrParts.length > 2) {
    return undefined;
  }
  const [addressInput, prefixInput] = cidrParts;
  if (!(addressInput && ipaddr.isValid(addressInput))) {
    return undefined;
  }
  const originalAddress = ipaddr.parse(addressInput);
  const maximumPrefixLength = originalAddress.kind() === "ipv4" ? 32 : 128;
  let originalPrefixLength = maximumPrefixLength;
  if (prefixInput !== undefined) {
    if (!CIDR_PREFIX_PATTERN.test(prefixInput)) {
      return undefined;
    }
    originalPrefixLength = Number(prefixInput);
  }
  if (originalPrefixLength > maximumPrefixLength) {
    return undefined;
  }
  const addressText = originalAddress.toString();
  const parsedAddress = parseIpAddress(addressText);
  if (!parsedAddress) {
    return undefined;
  }
  if (
    originalAddress instanceof ipaddr.IPv6 &&
    originalAddress.isIPv4MappedAddress() &&
    originalPrefixLength < 96
  ) {
    return undefined;
  }
  return {
    address: parsedAddress,
    prefixLength:
      originalAddress instanceof ipaddr.IPv6 &&
      originalAddress.isIPv4MappedAddress()
        ? originalPrefixLength - 96
        : originalPrefixLength,
  };
};

/** Parses raw proxy trust configuration into validated IP and CIDR values. */
export const parseClientIpProxyTrust = (
  input: ClientIpProxyTrustInput
): Result.Result<
  ClientIpProxyTrust,
  InvalidClientIpProxyTrustConfiguration
> => {
  const trustedProxyCidrs: ParsedIpCidr[] = [];
  for (const entry of input.trustedProxyCidrs) {
    const parsed = parseIpCidr(entry);
    if (!parsed) {
      return Result.fail({
        _tag: "InvalidClientIpProxyTrustConfiguration",
        entry,
      });
    }
    trustedProxyCidrs.push(parsed);
  }
  return Result.succeed({
    _tag: "ClientIpProxyTrust",
    trustAllHeaders: input.trustAllHeaders,
    trustedProxyCidrs,
  });
};

/** Default policy that ignores proxy forwarding headers. */
export const ClientIpProxyTrustNone: ClientIpProxyTrust = {
  _tag: "ClientIpProxyTrust",
  trustAllHeaders: false,
  trustedProxyCidrs: [],
};

const ipAddressInCidr = (
  candidate: ParsedIpAddress,
  cidr: ParsedIpCidr
): boolean =>
  candidate.address.kind() === cidr.address.address.kind() &&
  candidate.address.match(cidr.address.address, cidr.prefixLength);

const CLOUDFLARE_IP_RANGES = [
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
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
].flatMap((entry) => {
  const parsed = parseIpCidr(entry);
  return parsed ? [parsed] : [];
});

const isCloudflarePeer = (peer: ParsedIpAddress): boolean =>
  CLOUDFLARE_IP_RANGES.some((cidr) => ipAddressInCidr(peer, cidr));

/** Tests whether a peer address is covered by the parsed proxy trust policy. */
export const isTrustedProxy = (
  peerIp: string,
  proxyTrust: ClientIpProxyTrust = ClientIpProxyTrustNone
): boolean => {
  if (proxyTrust.trustAllHeaders) {
    return true;
  }
  const peer = parseIpAddress(peerIp);
  return Boolean(
    peer &&
    proxyTrust.trustedProxyCidrs.some((cidr) => ipAddressInCidr(peer, cidr))
  );
};

const forwardedForAddresses = (
  headers: Headers.Headers
): readonly ParsedIpAddress[] | undefined => {
  const raw = Option.getOrUndefined(Headers.get(headers, "x-forwarded-for"));
  if (!raw) {
    return undefined;
  }
  const parsed = raw.split(",").map(parseIpAddress);
  return parsed.length > 0 && parsed.every((address) => address !== undefined)
    ? parsed
    : undefined;
};

const resolveForwardedClientIp = (
  headers: Headers.Headers,
  peer: ParsedIpAddress,
  proxyTrust: ClientIpProxyTrust
): ClientIpAddress | undefined => {
  const cfConnectingIp = Option.getOrUndefined(
    Headers.get(headers, "cf-connecting-ip")
  );
  const parsedCloudflareClientIp = cfConnectingIp
    ? parseIpAddress(cfConnectingIp)
    : undefined;
  if (parsedCloudflareClientIp && isCloudflarePeer(peer)) {
    return {
      _tag: "ClientIpAddress",
      address: parsedCloudflareClientIp.text,
    };
  }

  if (!isTrustedProxy(peer.text, proxyTrust)) {
    return undefined;
  }

  const forwardedFor = forwardedForAddresses(headers);
  if (forwardedFor) {
    if (proxyTrust.trustAllHeaders) {
      const originatingAddress = forwardedFor[0];
      return originatingAddress
        ? { _tag: "ClientIpAddress", address: originatingAddress.text }
        : undefined;
    }
    for (let index = forwardedFor.length - 1; index >= 0; index -= 1) {
      const address = forwardedFor[index];
      if (address && !isTrustedProxy(address.text, proxyTrust)) {
        return { _tag: "ClientIpAddress", address: address.text };
      }
    }
    const furthestAddress = forwardedFor[0];
    if (furthestAddress) {
      return { _tag: "ClientIpAddress", address: furthestAddress.text };
    }
  }

  const realIp = Option.getOrUndefined(Headers.get(headers, "x-real-ip"));
  const parsedRealIp = realIp ? parseIpAddress(realIp) : undefined;
  return parsedRealIp
    ? { _tag: "ClientIpAddress", address: parsedRealIp.text }
    : undefined;
};

/** Resolves a validated forwarded client IP when a trusted peer is available. */
export const getClientIpFromHeaders = (
  headers: Headers.Headers,
  options: {
    readonly peer?: string;
    readonly proxyTrust?: ClientIpProxyTrust;
  } = {}
): ClientIpValue => {
  const peer = options.peer ? parseIpAddress(options.peer) : undefined;
  if (!peer) {
    return ClientIpUnavailable;
  }
  return (
    resolveForwardedClientIp(
      headers,
      peer,
      options.proxyTrust ?? ClientIpProxyTrustNone
    ) ?? ClientIpUnavailable
  );
};

/** Resolves the peer-anchored client IP for an HTTP server request. */
export const getClientIpFromRequest = (
  request: HttpServerRequest.HttpServerRequest,
  proxyTrust: ClientIpProxyTrust = ClientIpProxyTrustNone
): ClientIpValue => {
  const remoteAddress = Option.getOrUndefined(request.remoteAddress);
  const peer = remoteAddress ? parseIpAddress(remoteAddress) : undefined;
  if (!peer) {
    return ClientIpUnavailable;
  }
  return (
    resolveForwardedClientIp(request.headers, peer, proxyTrust) ?? {
      _tag: "ClientIpAddress",
      address: peer.text,
    }
  );
};

const provideClientIp =
  (proxyTrust: ClientIpProxyTrust) =>
  <A, E, R>(httpEffect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      Effect.provideService(
        httpEffect,
        ClientIp,
        getClientIpFromRequest(request, proxyTrust)
      )
    );

/** Builds route-scoped middleware that supplies the peer-anchored client IP. */
export const makeClientIpMiddleware = (proxyTrust: ClientIpProxyTrust) =>
  HttpRouter.middleware<{ provides: ClientIp }>()(provideClientIp(proxyTrust))
    .layer;

/** Builds global middleware that supplies client IP to HTTP and RPC handlers. */
export const makeClientIpGlobalMiddleware = (proxyTrust: ClientIpProxyTrust) =>
  HttpRouter.middleware<{ provides: ClientIp }>()(provideClientIp(proxyTrust), {
    global: true,
  });
