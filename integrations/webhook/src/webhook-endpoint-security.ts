import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import * as Effect from "effect/Effect";

import { WebhookEndpointSecurityError } from "./webhook-errors";

/** Explicit endpoint security policy; private-network egress is available only to local development receivers. */
export interface WebhookEndpointSecurityPolicy {
  readonly allowPrivateNetworkInDevelopment: boolean;
  readonly environment: "development" | "production" | "test";
}

/** An endpoint after syntax validation, DNS validation, and public-address pinning. */
export interface ValidatedWebhookEndpoint {
  readonly hostname: string;
  readonly pinnedAddresses: readonly string[];
  readonly url: URL;
}
/** Injectable DNS boundary makes mixed-answer and DNS-rebinding policy independently testable. */
export type WebhookDnsResolver = (
  hostname: string
) => Effect.Effect<readonly string[], WebhookEndpointSecurityError>;

const localhostNames = new Set(["localhost", "localhost.", "ip6-localhost"]);
const bracketPattern = /^\[|\]$/g;
const ipv4MappedPattern = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/;
const ipv4MappedHexPattern = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/;

/** IPv6 ranges that must never be webhook targets; checked via net.BlockList subnet matching. */
const ipv6Blocklist = new BlockList();
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 well-known prefix (RFC 6052)
  ["64:ff9b:1::", 48], // NAT64 local-use prefix (RFC 8215)
  ["100::", 64], // discard-only (RFC 6666)
  ["2001::", 23], // IETF protocol assignments: Teredo, benchmarking, AMT, ORCHID, ...
  ["2001:db8::", 32], // documentation (RFC 3849)
  ["2002::", 16], // 6to4 (RFC 3056)
  ["3fff::", 20], // documentation (RFC 9637)
  ["fc00::", 7], // unique local (RFC 4193)
  ["fe80::", 10], // link-local (RFC 4291)
  ["fec0::", 10], // site-local, deprecated (RFC 3879)
  ["ff00::", 8], // multicast (RFC 4291)
] as const) {
  ipv6Blocklist.addSubnet(network, prefix, "ipv6");
}

const privateIpv4Address = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  if (octets.length !== 4 || first === undefined || second === undefined) {
    return true;
  }
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 88) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0)
  );
};

const privateIpv6Address = (address: string): boolean => {
  // Canonicalize to compressed form (RFC 5952) so every spelling of an address
  // (e.g. "0:0:0:0:0:ffff:7f00:1" vs "::ffff:7f00:1") classifies identically.
  const value = new URL(
    `http://[${address.replace(bracketPattern, "")}]/`
  ).hostname
    .replace(bracketPattern, "")
    .toLowerCase();
  const ipv4Mapped = value.match(ipv4MappedPattern)?.[1];
  if (ipv4Mapped !== undefined) {
    return privateIpv4Address(ipv4Mapped);
  }
  const mappedHex = value.match(ipv4MappedHexPattern);
  if (mappedHex?.[1] !== undefined && mappedHex[2] !== undefined) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return privateIpv4Address(
      `${Math.floor(high / 256)}.${high % 256}.${Math.floor(low / 256)}.${low % 256}`
    );
  }
  return ipv6Blocklist.check(value, "ipv6");
};

/** Returns whether an IP literal is private, loopback, link-local, multicast, documentation, or reserved. */
export const isWebhookPrivateOrReservedAddress = (address: string): boolean => {
  const normalizedAddress = address.replace(bracketPattern, "");
  const family = isIP(normalizedAddress);
  if (family === 4) {
    return privateIpv4Address(normalizedAddress);
  }
  if (family === 6) {
    return privateIpv6Address(normalizedAddress);
  }
  return true;
};

const privateNetworkAllowed = (
  policy: WebhookEndpointSecurityPolicy
): boolean =>
  policy.environment === "development" &&
  policy.allowPrivateNetworkInDevelopment;

/** Parses an endpoint URL before it is persisted, rejecting credentials, fragments, local hostnames, and production HTTP. */
export const parseWebhookEndpointUrl = (
  input: string,
  policy: WebhookEndpointSecurityPolicy
): Effect.Effect<URL, WebhookEndpointSecurityError> =>
  Effect.try({
    try: () => new URL(input),
    catch: () =>
      new WebhookEndpointSecurityError({
        reason: "Webhook endpoint URL is invalid",
      }),
  }).pipe(
    Effect.flatMap((url) => {
      if (url.protocol !== "https:" && policy.environment === "production") {
        return Effect.fail(
          new WebhookEndpointSecurityError({
            reason: "Webhook endpoint must use HTTPS in production",
          })
        );
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return Effect.fail(
          new WebhookEndpointSecurityError({
            reason: "Webhook endpoint must use HTTP or HTTPS",
          })
        );
      }
      if (url.username !== "" || url.password !== "" || url.hash !== "") {
        return Effect.fail(
          new WebhookEndpointSecurityError({
            reason: "Webhook endpoint cannot include credentials or a fragment",
          })
        );
      }
      if (localhostNames.has(url.hostname.toLowerCase())) {
        return privateNetworkAllowed(policy)
          ? Effect.succeed(url)
          : Effect.fail(
              new WebhookEndpointSecurityError({
                reason: "Webhook endpoint cannot target localhost",
              })
            );
      }
      if (
        isIP(url.hostname.replace(bracketPattern, "")) !== 0 &&
        isWebhookPrivateOrReservedAddress(url.hostname)
      ) {
        return privateNetworkAllowed(policy)
          ? Effect.succeed(url)
          : Effect.fail(
              new WebhookEndpointSecurityError({
                reason:
                  "Webhook endpoint cannot target a private or reserved address",
              })
            );
      }
      return Effect.succeed(url);
    })
  );

/** Resolves every address before use and pins only validated addresses to prevent DNS rebinding after endpoint validation. */
export const resolveAndParseWebhookEndpoint = (
  endpointUrl: string,
  policy: WebhookEndpointSecurityPolicy,
  resolver?: WebhookDnsResolver
): Effect.Effect<ValidatedWebhookEndpoint, WebhookEndpointSecurityError> =>
  Effect.flatMap(parseWebhookEndpointUrl(endpointUrl, policy), (url) =>
    (resolver === undefined
      ? Effect.tryPromise({
          try: () => lookup(url.hostname, { all: true, verbatim: true }),
          catch: () =>
            new WebhookEndpointSecurityError({
              reason: "Webhook endpoint hostname could not be resolved",
            }),
        }).pipe(
          Effect.map((records) => records.map((record) => record.address))
        )
      : resolver(url.hostname)
    ).pipe(
      Effect.flatMap((records) => {
        const addresses = records;
        if (addresses.length === 0) {
          return Effect.fail(
            new WebhookEndpointSecurityError({
              reason: "Webhook endpoint hostname has no addresses",
            })
          );
        }
        if (
          !privateNetworkAllowed(policy) &&
          addresses.some(isWebhookPrivateOrReservedAddress)
        ) {
          return Effect.fail(
            new WebhookEndpointSecurityError({
              reason:
                "Webhook endpoint hostname resolved to a private or reserved address",
            })
          );
        }
        return Effect.succeed({
          url,
          hostname: url.hostname,
          pinnedAddresses: addresses,
        });
      })
    )
  );
