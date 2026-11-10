import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserPublicEnv,
  getServerApiBaseUrl,
} from "./server-runtime-public-env";

const baseEnv = {
  API_URL: "https://api.example.test",
  APP_URL: "https://app.example.test",
  APP_ROOT_DOMAIN: "example.test",
} as const;

const stubBaseEnv = () => {
  for (const [key, value] of Object.entries(baseEnv)) {
    vi.stubEnv(key, value);
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getServerApiBaseUrl", () => {
  it("falls back to API_URL when the internal origin is unset", () => {
    stubBaseEnv();
    vi.stubEnv("API_URL_INTERNAL", "");

    expect(getServerApiBaseUrl()).toBe(baseEnv.API_URL);
  });

  it("prefers the internal origin for server-side calls", () => {
    stubBaseEnv();
    vi.stubEnv("API_URL_INTERNAL", "http://server:8080");

    expect(getServerApiBaseUrl()).toBe("http://server:8080");
  });

  it("does not expose the internal origin to the browser", () => {
    stubBaseEnv();
    vi.stubEnv("API_URL_INTERNAL", "http://server:8080");

    expect(getBrowserPublicEnv()).not.toHaveProperty("API_URL_INTERNAL");
  });
});
