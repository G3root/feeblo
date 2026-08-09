// biome-ignore-all lint/suspicious/noBitwiseOperators: IP/CIDR arithmetic requires bitwise operators on BigInt addresses.
// NOTE: this module is imported by browser bundles, so it must not import any
// Node.js built-ins or read process.env.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

/** The peer-anchored client IP available during an HTTP request. */
export class ClientIp extends Context.Service<ClientIp, string>()(
  "@feeblo/domain/ClientIp"
) {}

type ParsedIpAddress = {
  readonly text: string;
  readonly version: 4 | 6;
  readonly value: bigint;
};

type ParsedIpCidr = {
  readonly address: ParsedIpAddress;
  readonly prefixLength: number;
};

/** Parsed proxy trust policy, constructed once from server configuration. */
export type ClientIpProxyTrust = {
  readonly _tag: "ClientIpProxyTrust";
  readonly trustAllHeaders: boolean;
  readonly trustedProxyCidrs: readonly ParsedIpCidr[];
};

/** Raw proxy trust values read at the server composition root. */
export type ClientIpProxyTrustInput = {
  readonly trustAllHeaders: boolean;
  readonly trustedProxyCidrs: readonly string[];
};

/** Configuration error produced when a trusted proxy IP or CIDR is malformed. */
export type InvalidClientIpProxyTrustConfiguration = {
  readonly _tag: "InvalidClientIpProxyTrustConfiguration";
  readonly entry: string;
};

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_REGEX = /^[0-9a-f]{1,4}$/;

const parseIpAddress = (input: string): ParsedIpAddress | undefined => {
  const text = input.trim();
  const ipv4 = IPV4_REGEX.exec(text);
  if (ipv4) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) {
      return undefined;
    }
    let value = 0n;
    for (const octet of octets) {
      value = (value << 8n) | BigInt(octet);
    }
    return { text, version: 4, value };
  }

  if (!text.includes(":")) {
    return undefined;
  }

  const compressionParts = text.toLowerCase().split("::");
  if (compressionParts.length > 2) {
    return undefined;
  }
  const hasCompression = compressionParts.length === 2;
  let leftParts = compressionParts[0] ? compressionParts[0].split(":") : [];
  let rightParts = compressionParts[1] ? compressionParts[1].split(":") : [];

  const lastGroup =
    rightParts.length > 0 ? rightParts.at(-1) : leftParts.at(-1);
  if (lastGroup?.includes(".")) {
    const quad = parseIpAddress(lastGroup);
    if (!quad || quad.version !== 4) {
      return undefined;
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

  const explicitGroupCount = leftParts.length + rightParts.length;
  if (
    (hasCompression && explicitGroupCount >= 8) ||
    (!hasCompression && explicitGroupCount !== 8)
  ) {
    return undefined;
  }
  const groups = [
    ...leftParts,
    ...Array.from({ length: 8 - explicitGroupCount }, () => "0"),
    ...rightParts,
  ];
  let value = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP_REGEX.test(group)) {
      return undefined;
    }
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return { text, version: 6, value };
};

const parseIpCidr = (input: string): ParsedIpCidr | undefined => {
  const parts = input.trim().split("/");
  if (parts.length > 2 || !parts[0]) {
    return undefined;
  }
  const address = parseIpAddress(parts[0]);
  if (!address) {
    return undefined;
  }
  const maxBits = address.version === 4 ? 32 : 128;
  const prefixLength = parts[1] === undefined ? maxBits : Number(parts[1]);
  if (
    parts[1] === "" ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > maxBits
  ) {
    return undefined;
  }
  return { address, prefixLength };
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

const ipv4MappedValue = (ipv4: ParsedIpAddress): bigint =>
  (0xffffn << 32n) | ipv4.value;

const ipAddressInCidr = (
  candidate: ParsedIpAddress,
  cidr: ParsedIpCidr
): boolean => {
  const maxBits = cidr.address.version === 4 ? 32 : 128;
  let candidateValue: bigint;
  if (candidate.version === cidr.address.version) {
    candidateValue = candidate.value;
  } else if (candidate.version === 4 && cidr.address.version === 6) {
    candidateValue = ipv4MappedValue(candidate);
  } else {
    const mappedPrefix = candidate.value >> 32n;
    if (mappedPrefix !== 0xffffn) {
      return false;
    }
    candidateValue = candidate.value & 0xffffffffn;
  }
  const mask =
    cidr.prefixLength === 0
      ? 0n
      : ((1n << BigInt(cidr.prefixLength)) - 1n) <<
        BigInt(maxBits - cidr.prefixLength);
  return (candidateValue & mask) === (cidr.address.value & mask);
};

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
): string | undefined => {
  const cfConnectingIp = Option.getOrUndefined(
    Headers.get(headers, "cf-connecting-ip")
  );
  const parsedCloudflareClientIp = cfConnectingIp
    ? parseIpAddress(cfConnectingIp)
    : undefined;
  if (parsedCloudflareClientIp && isCloudflarePeer(peer)) {
    return parsedCloudflareClientIp.text;
  }

  if (!isTrustedProxy(peer.text, proxyTrust)) {
    return undefined;
  }

  const forwardedFor = forwardedForAddresses(headers);
  if (forwardedFor) {
    if (proxyTrust.trustAllHeaders) {
      return forwardedFor.at(-1)?.text;
    }
    for (let index = forwardedFor.length - 1; index >= 0; index -= 1) {
      const address = forwardedFor[index];
      if (address && !isTrustedProxy(address.text, proxyTrust)) {
        return address.text;
      }
    }
  }

  const realIp = Option.getOrUndefined(Headers.get(headers, "x-real-ip"));
  return realIp ? parseIpAddress(realIp)?.text : undefined;
};

/** Resolves a validated forwarded client IP when a trusted peer is available. */
export const getClientIpFromHeaders = (
  headers: Headers.Headers,
  options: {
    readonly peer?: string;
    readonly proxyTrust?: ClientIpProxyTrust;
  } = {}
): string => {
  const peer = options.peer ? parseIpAddress(options.peer) : undefined;
  if (!peer) {
    return "unknown";
  }
  return (
    resolveForwardedClientIp(
      headers,
      peer,
      options.proxyTrust ?? ClientIpProxyTrustNone
    ) ?? "unknown"
  );
};

/** Resolves the peer-anchored client IP for an HTTP server request. */
export const getClientIpFromRequest = (
  request: HttpServerRequest.HttpServerRequest,
  proxyTrust: ClientIpProxyTrust = ClientIpProxyTrustNone
): string => {
  const remoteAddress = Option.getOrUndefined(request.remoteAddress);
  const peer = remoteAddress ? parseIpAddress(remoteAddress) : undefined;
  if (!peer) {
    return "unknown";
  }
  return (
    resolveForwardedClientIp(request.headers, peer, proxyTrust) ?? peer.text
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
