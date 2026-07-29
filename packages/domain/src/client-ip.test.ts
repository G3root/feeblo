import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { describe, expect, it } from "vitest";

import { getClientIpFromHeaders, getClientIpFromRequest } from "./client-ip";

describe("getClientIpFromHeaders", () => {
  it("prefers the Cloudflare connecting IP", () => {
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

    expect(getClientIpFromHeaders(headers)).toBe("198.51.100.1");
  });

  it("falls back to the real IP", () => {
    const headers = Headers.fromInput({ "x-real-ip": "192.0.2.1" });

    expect(getClientIpFromHeaders(headers)).toBe("192.0.2.1");
  });

  it("returns unknown when no client IP header is present", () => {
    expect(getClientIpFromHeaders(Headers.empty)).toBe("unknown");
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
});
