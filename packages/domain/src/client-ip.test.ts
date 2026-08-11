import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { FastCheck } from "effect/testing";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import ipaddr from "ipaddr.js";

import {
  type ClientIpValue,
  getClientIpFromHeaders as getClientIpValueFromHeaders,
  getClientIpFromRequest as getClientIpValueFromRequest,
  isTrustedProxy,
  parseClientIpProxyTrust,
} from "./client-ip";

const clientIpText = (clientIp: ClientIpValue): string =>
  clientIp._tag === "ClientIpAddress" ? clientIp.address : "unknown";

const getClientIpFromHeaders = (
  ...args: Parameters<typeof getClientIpValueFromHeaders>
): string => clientIpText(getClientIpValueFromHeaders(...args));

const getClientIpFromRequest = (
  ...args: Parameters<typeof getClientIpValueFromRequest>
): string => clientIpText(getClientIpValueFromRequest(...args));

const proxyTrust = (
  trustedProxyCidrs: readonly string[] = [],
  trustAllHeaders = false
) =>
  Result.getOrThrow(
    parseClientIpProxyTrust({ trustAllHeaders, trustedProxyCidrs })
  );

describe("getClientIpFromHeaders", () => {
  it("refuses to trust forwarded headers without a peer", () => {
    const headers = Headers.fromInput({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "192.0.2.1",
    });

    expect(getClientIpFromHeaders(headers)).toBe("unknown");
  });

  it("refuses to trust forwarded headers from a peer-less rate-limit fallback even when proxy trust is enabled", () => {
    const trust = proxyTrust([], true);
    const headers = Headers.fromInput({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "192.0.2.1",
    });

    // Without the TCP peer there is no way to validate provenance, so the
    // rate-limit fallback cannot be spoofed by arbitrary header values.
    expect(getClientIpFromHeaders(headers, { proxyTrust: trust })).toBe(
      "unknown"
    );
  });

  it("honors cf-connecting-ip when the peer is a Cloudflare edge address", () => {
    const headers = Headers.fromInput({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "192.0.2.1",
    });

    expect(getClientIpFromHeaders(headers, { peer: "173.245.48.7" })).toBe(
      "203.0.113.1"
    );
  });

  it("rejects cf-connecting-ip from a non-Cloudflare peer", () => {
    const headers = Headers.fromInput({ "cf-connecting-ip": "203.0.113.1" });

    expect(getClientIpFromHeaders(headers, { peer: "10.0.0.4" })).toBe(
      "unknown"
    );
  });

  it("walks x-forwarded-for from the right, skipping trusted proxy hops", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const headers = Headers.fromInput({
      "x-forwarded-for": " 192.0.2.99, 198.51.100.1, 10.0.0.7 ",
    });

    expect(
      getClientIpFromHeaders(headers, { peer: "10.0.0.8", proxyTrust: trust })
    ).toBe("198.51.100.1");
  });

  it("ignores a malformed x-forwarded-for chain", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const headers = Headers.fromInput({
      "x-forwarded-for": "not-an-ip, 10.0.0.7",
    });

    expect(
      getClientIpFromHeaders(headers, { peer: "10.0.0.8", proxyTrust: trust })
    ).toBe("unknown");
  });

  it("falls back to x-real-ip from a trusted proxy peer", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const headers = Headers.fromInput({ "x-real-ip": "192.0.2.1" });

    expect(
      getClientIpFromHeaders(headers, { peer: "10.0.0.4", proxyTrust: trust })
    ).toBe("192.0.2.1");
  });

  it("returns unknown when no client IP header is present", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);

    expect(
      getClientIpFromHeaders(Headers.empty, {
        peer: "10.0.0.4",
        proxyTrust: trust,
      })
    ).toBe("unknown");
  });
});

describe("isTrustedProxy", () => {
  it("rejects unknown peers by default", () => {
    expect(isTrustedProxy("198.51.100.10")).toBe(false);
  });

  it("matches exact configured proxy IPs", () => {
    const trust = proxyTrust(["10.0.0.1", "192.168.1.5"]);

    expect(isTrustedProxy("10.0.0.1", trust)).toBe(true);
    expect(isTrustedProxy("192.168.1.5", trust)).toBe(true);
    expect(isTrustedProxy("10.0.0.2", trust)).toBe(false);
  });

  it("matches IPv4 CIDR ranges", () => {
    const trust = proxyTrust(["10.0.0.0/8", "192.168.1.0/24"]);

    expect(isTrustedProxy("10.11.12.13", trust)).toBe(true);
    expect(isTrustedProxy("192.168.1.200", trust)).toBe(true);
    expect(isTrustedProxy("192.168.2.1", trust)).toBe(false);
  });

  it("matches IPv6 CIDR ranges", () => {
    const trust = proxyTrust(["fd00::/8"]);

    expect(isTrustedProxy("fd00:1:2:3:4:5:6:7", trust)).toBe(true);
    expect(isTrustedProxy("fd01::1", trust)).toBe(true);
    expect(isTrustedProxy("fe80::1", trust)).toBe(false);
  });

  it("matches IPv4-mapped IPv6 peers against trusted IPv4 CIDRs", () => {
    const trust = proxyTrust(["10.0.0.4", "192.168.1.0/24"]);

    expect(isTrustedProxy("::ffff:10.0.0.4", trust)).toBe(true);
    expect(isTrustedProxy("::ffff:192.168.1.9", trust)).toBe(true);
    expect(isTrustedProxy("::ffff:10.0.0.5", trust)).toBe(false);
    expect(isTrustedProxy("::ffff:8.8.8.8", trust)).toBe(false);
  });

  it("matches IPv4-mapped IPv6 CIDRs", () => {
    const trust = proxyTrust(["::ffff:10.0.0.0/120"]);

    expect(isTrustedProxy("::ffff:10.0.0.9", trust)).toBe(true);
    expect(isTrustedProxy("10.0.0.9", trust)).toBe(true);
    expect(isTrustedProxy("::ffff:10.0.1.9", trust)).toBe(false);
  });

  it("rejects malformed IPv6 proxy configuration", () => {
    expect(
      Result.isFailure(
        parseClientIpProxyTrust({
          trustAllHeaders: false,
          trustedProxyCidrs: ["2001::db8::1"],
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        parseClientIpProxyTrust({
          trustAllHeaders: false,
          trustedProxyCidrs: ["2001:db8:1:2:3:4:5"],
        })
      )
    ).toBe(true);
  });

  it("returns a configuration failure for an invalid CIDR prefix", () => {
    const result = parseClientIpProxyTrust({
      trustAllHeaders: false,
      trustedProxyCidrs: ["10.0.0.0/33"],
    });

    expect(result).toEqual(
      Result.fail({
        _tag: "InvalidClientIpProxyTrustConfiguration",
        entry: "10.0.0.0/33",
      })
    );
  });

  it("still parses IPv6 addresses with a dotted-quad tail as IPv6 when not IPv4-mapped", () => {
    const trust = proxyTrust(["2001:db8::/32"]);

    expect(isTrustedProxy("2001:db8::10.0.0.4", trust)).toBe(true);
    expect(isTrustedProxy("2001:db9::10.0.0.4", trust)).toBe(false);
  });

  it("trusts every immediate peer in trust-all mode", () => {
    const trust = proxyTrust([], true);

    expect(isTrustedProxy("203.0.113.7", trust)).toBe(true);
  });

  it("uses the originating forwarded address when every proxy is trusted", () => {
    const trust = proxyTrust([], true);
    const headers = Headers.fromInput({
      "x-forwarded-for": "192.0.2.99, 198.51.100.7",
    });

    expect(
      getClientIpFromHeaders(headers, {
        peer: "10.0.0.4",
        proxyTrust: trust,
      })
    ).toBe("192.0.2.99");
  });

  it("does not let an IPv6 catch-all CIDR trust IPv4 peers", () => {
    const trust = proxyTrust(["::/0"]);

    expect(isTrustedProxy("203.0.113.7", trust)).toBe(false);
    expect(isTrustedProxy("2001:db8::7", trust)).toBe(true);
  });

  it.prop(
    "matches generated IPv4 CIDRs according to their numeric prefixes",
    [
      FastCheck.array(FastCheck.integer({ min: 0, max: 255 }), {
        minLength: 4,
        maxLength: 4,
      }),
      FastCheck.array(FastCheck.integer({ min: 0, max: 255 }), {
        minLength: 4,
        maxLength: 4,
      }),
      FastCheck.integer({ min: 0, max: 32 }),
    ],
    ([networkOctets, candidateOctets, prefixLength]) => {
      const network = networkOctets.join(".");
      const candidate = candidateOctets.join(".");
      const networkValue = networkOctets.reduce(
        (value, octet) => value * 256n + BigInt(octet),
        0n
      );
      const candidateValue = candidateOctets.reduce(
        (value, octet) => value * 256n + BigInt(octet),
        0n
      );
      const prefixDivisor = 2n ** BigInt(32 - prefixLength);
      const expected =
        networkValue / prefixDivisor === candidateValue / prefixDivisor;
      const trust = proxyTrust([`${network}/${prefixLength}`]);

      expect(isTrustedProxy(candidate, trust)).toBe(expected);
    }
  );

  it.prop(
    "accepts generated canonical IPv6 addresses as exact trusted peers",
    [FastCheck.uint8Array({ minLength: 16, maxLength: 16 })],
    ([addressBytes]) => {
      const address = ipaddr.fromByteArray([...addressBytes]).toString();
      const trust = proxyTrust([address]);

      expect(isTrustedProxy(address, trust)).toBe(true);
    }
  );

  it("rejects malformed single-address forwarding headers", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);

    expect(
      getClientIpFromHeaders(Headers.fromInput({ "x-real-ip": "not-an-ip" }), {
        peer: "10.0.0.4",
        proxyTrust: trust,
      })
    ).toBe("unknown");
    expect(
      getClientIpFromHeaders(
        Headers.fromInput({ "cf-connecting-ip": "not-an-ip" }),
        { peer: "173.245.48.7", proxyTrust: trust }
      )
    ).toBe("unknown");
  });
});

describe("getClientIpFromRequest", () => {
  it("prefers the trusted remote address over forwarded headers", () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      })
    ).modify({ remoteAddress: Option.some("203.0.113.1") });

    expect(getClientIpFromRequest(request)).toBe("203.0.113.1");
  });

  it("ignores spoofed forwarding headers from a direct client", () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: {
          "cf-connecting-ip": "198.51.100.1",
          "x-forwarded-for": "198.51.100.2",
        },
      })
    ).modify({ remoteAddress: Option.some("203.0.113.9") });

    expect(getClientIpFromRequest(request)).toBe("203.0.113.9");
  });

  it("honors cf-connecting-ip when the peer is a Cloudflare edge address", () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "cf-connecting-ip": "198.51.100.1" },
      })
    ).modify({ remoteAddress: Option.some("173.245.48.7") });

    expect(getClientIpFromRequest(request)).toBe("198.51.100.1");
  });

  it("ignores cf-connecting-ip from a non-Cloudflare trusted proxy", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "cf-connecting-ip": "198.51.100.1" },
      })
    ).modify({ remoteAddress: Option.some("10.0.0.4") });

    expect(getClientIpFromRequest(request, trust)).toBe("10.0.0.4");
  });

  it("honors forwarding headers only when the peer is a trusted proxy", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "198.51.100.7" },
      })
    ).modify({ remoteAddress: Option.some("10.0.0.4") });

    expect(getClientIpFromRequest(request, trust)).toBe("198.51.100.7");
  });

  it("discards attacker-supplied addresses left of the trusted forwarding chain", () => {
    const trust = proxyTrust(["10.0.0.0/24"]);
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.1, 10.0.0.7" },
      })
    ).modify({ remoteAddress: Option.some("10.0.0.8") });

    expect(getClientIpFromRequest(request, trust)).toBe("198.51.100.1");
  });

  it("uses the furthest forwarded address when every forwarding hop is trusted", () => {
    const trust = proxyTrust(["10.0.0.0/24"]);
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "10.0.0.7, 10.0.0.8" },
      })
    ).modify({ remoteAddress: Option.some("10.0.0.8") });

    expect(getClientIpFromRequest(request, trust)).toBe("10.0.0.7");
  });

  it("falls back to the proxy peer when no forwarding header is present", () => {
    const trust = proxyTrust(["10.0.0.0/8"]);
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com")
    ).modify({ remoteAddress: Option.some("10.0.0.4") });

    expect(getClientIpFromRequest(request, trust)).toBe("10.0.0.4");
  });

  it("returns unknown when there is no peer and no trusted headers", () => {
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      })
    );

    expect(getClientIpFromRequest(request)).toBe("unknown");
  });
});
