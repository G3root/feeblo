import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { afterEach, describe, expect, it } from "vitest";

import {
  getClientIpFromHeaders,
  getClientIpFromRequest,
  isTrustedProxy,
} from "./client-ip";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getClientIpFromHeaders", () => {
  it("refuses to trust forwarded headers by default", () => {
    const headers = Headers.fromInput({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "192.0.2.1",
    });

    expect(getClientIpFromHeaders(headers)).toBe("unknown");
  });

  it("prefers the Cloudflare connecting IP when proxy trust is enabled", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const headers = Headers.fromInput({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "192.0.2.1",
    });

    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.1");
  });

  it("uses the first forwarded IP", () => {
    const headers = Headers.fromInput({
      "x-forwarded-for": " 198.51.100.1, 10.0.0.1 ",
    });

    expect(
      getClientIpFromHeaders(headers, { trustForwardedHeaders: true })
    ).toBe("198.51.100.1");
  });

  it("falls back to the real IP", () => {
    const headers = Headers.fromInput({ "x-real-ip": "192.0.2.1" });

    expect(
      getClientIpFromHeaders(headers, { trustForwardedHeaders: true })
    ).toBe("192.0.2.1");
  });

  it("returns unknown when no client IP header is present", () => {
    expect(
      getClientIpFromHeaders(Headers.empty, {
        trustForwardedHeaders: true,
      })
    ).toBe("unknown");
  });
});

describe("isTrustedProxy", () => {
  it("rejects unknown peers by default", () => {
    expect(isTrustedProxy("198.51.100.10")).toBe(false);
  });

  it("matches exact configured proxy IPs", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.1,192.168.1.5";

    expect(isTrustedProxy("10.0.0.1")).toBe(true);
    expect(isTrustedProxy("192.168.1.5")).toBe(true);
    expect(isTrustedProxy("10.0.0.2")).toBe(false);
  });

  it("matches IPv4 CIDR ranges", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8,192.168.1.0/24";

    expect(isTrustedProxy("10.11.12.13")).toBe(true);
    expect(isTrustedProxy("192.168.1.200")).toBe(true);
    expect(isTrustedProxy("192.168.2.1")).toBe(false);
  });

  it("matches IPv6 CIDR ranges", () => {
    process.env.TRUSTED_PROXY_IPS = "fd00::/8";

    expect(isTrustedProxy("fd00:1:2:3:4:5:6:7")).toBe(true);
    expect(isTrustedProxy("fd01::1")).toBe(true);
    expect(isTrustedProxy("fe80::1")).toBe(false);
  });

  it("trusts everything when TRUST_PROXY_HEADERS is set", () => {
    process.env.TRUST_PROXY_HEADERS = "true";

    expect(isTrustedProxy("203.0.113.7")).toBe(true);
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

  it("honors forwarding headers only when the peer is a trusted proxy", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com", {
        headers: { "x-forwarded-for": "198.51.100.7" },
      })
    ).modify({ remoteAddress: Option.some("10.0.0.4") });

    expect(getClientIpFromRequest(request)).toBe("198.51.100.7");
  });

  it("falls back to the proxy peer when no forwarding header is present", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    const request = HttpServerRequest.fromWeb(
      new Request("http://example.com")
    ).modify({ remoteAddress: Option.some("10.0.0.4") });

    expect(getClientIpFromRequest(request)).toBe("10.0.0.4");
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
