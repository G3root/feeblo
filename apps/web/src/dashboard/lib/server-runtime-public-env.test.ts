import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getServerRuntimePublicEnv } from "./server-runtime-public-env";

/**
 * The optional settings in this module decide behaviour by being absent —
 * `posthog-provider.tsx` falls back to the PostHog cloud host with `??` — so a
 * blank value has to arrive as `undefined` rather than as `""`. A container
 * environment supplies plenty of empty strings, and Compose passes
 * `${VAR:-}` for exactly these four.
 */
const optionalKeys = [
  "APP_RELEASE",
  "TURNSTILE_SITE_KEY",
  "NO_INDEX",
  "POSTHOG_KEY",
  "POSTHOG_HOST",
] as const;

const requiredKeys = ["API_URL", "APP_URL", "APP_ROOT_DOMAIN"] as const;

describe("getServerRuntimePublicEnv", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of [...requiredKeys, ...optionalKeys]) {
      original.set(key, process.env[key]);
    }
    process.env.API_URL = "https://api.example.test";
    process.env.APP_URL = "https://app.example.test";
    process.env.APP_ROOT_DOMAIN = "example.test";
  });

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("reads a blank optional setting as unset", () => {
    for (const key of optionalKeys) {
      process.env[key] = "";
    }

    const env = getServerRuntimePublicEnv();

    expect(env.appRelease).toBeUndefined();
    expect(env.turnstileSiteKey).toBeUndefined();
    expect(env.posthogKey).toBeUndefined();
    expect(env.posthogHost).toBeUndefined();
  });

  it("reads a whitespace-only optional setting as unset", () => {
    process.env.POSTHOG_HOST = "   ";

    expect(getServerRuntimePublicEnv().posthogHost).toBeUndefined();
  });

  it("keeps a configured optional setting", () => {
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";

    expect(getServerRuntimePublicEnv().posthogHost).toBe(
      "https://eu.i.posthog.com"
    );
  });
});
