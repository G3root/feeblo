import { getSecret } from "astro:env/server";

export function getPublicEnvServer() {
  return {
    // SAFETY: The upstream contract guarantees a string here.
    API_URL: getSecret("API_URL") as string,
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    APP_URL: getSecret("APP_URL") as string,
    // SAFETY: The upstream contract guarantees a string here.
    APP_ROOT_DOMAIN: getSecret("APP_ROOT_DOMAIN") as string,
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    APP_RELEASE: getSecret("APP_RELEASE") as string,
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    TURNSTILE_SITE_KEY: getSecret("TURNSTILE_SITE_KEY") as string | undefined,
    // SAFETY: The upstream contract guarantees a string here.
    // SAFETY: The upstream contract guarantees a string here.
    POSTHOG_KEY: getSecret("POSTHOG_KEY") as string | undefined,
    // SAFETY: The upstream contract guarantees a string here.
    POSTHOG_HOST: getSecret("POSTHOG_HOST") as string | undefined,
  };
}

export function getServerRuntimePublicEnv() {
  const env = getPublicEnvServer();

  return {
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appRelease: env.APP_RELEASE,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    posthogKey: env.POSTHOG_KEY,
    posthogHost: env.POSTHOG_HOST,
  };
}

/**
 * Absolute API origin for `<link rel="preconnect">`, or empty when the
 * browser talks to the API same-origin (dev proxy rewrites API_URL to
 * `/api`) — same-origin needs no preconnect. Guards against relative and
 * malformed values instead of throwing during render.
 */
export function apiPreconnectOrigins(): string[] {
  const apiUrl = getServerRuntimePublicEnv().apiUrl;
  if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
    return [];
  }
  try {
    return [new URL(apiUrl).origin];
  } catch {
    return [];
  }
}
