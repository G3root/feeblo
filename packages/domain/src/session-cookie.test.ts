import { describe, expect, it } from "vitest";

import {
  getSessionCookieName,
  getSessionCookieNameForUrl,
} from "./session-cookie";

describe("getSessionCookieNameForUrl", () => {
  it("uses __Secure- prefix for https api url", () => {
    expect(getSessionCookieNameForUrl("https://api.example.com")).toBe(
      "__Secure-better-auth.session_token"
    );
    expect(getSessionCookieNameForUrl("https://api.feeblo.com/api")).toBe(
      "__Secure-better-auth.session_token"
    );
  });

  it("uses plain cookie for http api url", () => {
    expect(getSessionCookieNameForUrl("http://localhost:3000")).toBe(
      "better-auth.session_token"
    );
    expect(getSessionCookieNameForUrl("http://api.example.com")).toBe(
      "better-auth.session_token"
    );
  });

  it("uses plain cookie when api url is undefined", () => {
    expect(getSessionCookieNameForUrl(undefined)).toBe(
      "better-auth.session_token"
    );
  });

  it("is strict about https prefix (not httpss or protocol-relative)", () => {
    expect(getSessionCookieNameForUrl("httpss://api.example.com")).toBe(
      "better-auth.session_token"
    );
    expect(getSessionCookieNameForUrl("//api.example.com")).toBe(
      "better-auth.session_token"
    );
    expect(getSessionCookieNameForUrl("")).toBe("better-auth.session_token");
  });
});

describe("getSessionCookieName legacy env fallback", () => {
  it("delegates to pure function when API_URL is set", () => {
    const prev = process.env.API_URL;
    process.env.API_URL = "https://api.example.com";
    expect(getSessionCookieName()).toBe("__Secure-better-auth.session_token");
    process.env.API_URL = "http://api.example.com";
    expect(getSessionCookieName()).toBe("better-auth.session_token");
    if (prev === undefined) delete process.env.API_URL;
    else process.env.API_URL = prev;
  });

  it("falls back to NODE_ENV production when API_URL absent", () => {
    const prevApi = process.env.API_URL;
    const prevEnv = process.env.NODE_ENV;
    delete process.env.API_URL;
    process.env.NODE_ENV = "production";
    expect(getSessionCookieName()).toBe("__Secure-better-auth.session_token");
    process.env.NODE_ENV = "development";
    expect(getSessionCookieName()).toBe("better-auth.session_token");
    if (prevApi === undefined) delete process.env.API_URL;
    else process.env.API_URL = prevApi;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });
});
