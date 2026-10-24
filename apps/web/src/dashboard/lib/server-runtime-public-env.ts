import { z } from "zod";

/**
 * The app's runtime configuration, read per request.
 *
 * The Astro build validated these through `envField`; TanStack Start has no
 * build-time env schema, and on Cloudflare Workers env is injected per request
 * (a module-scope read evaluates to `undefined`), so the read happens inside
 * this function and callers resolve it at call time. Every consumer is a
 * server function, server route, or the custom server entry — the browser
 * gets the public subset through the root env script instead.
 */
const serverEnvSchema = z.object({
  API_URL: z.string().min(1),
  APP_URL: z.string().min(1),
  APP_ROOT_DOMAIN: z.string().min(1),
  APP_RELEASE: z.string().optional(),
  // The deployment environment name (`APP_ENV`, defaulting to `NODE_ENV` on
  // the server). The browser uses it for Sentry and PostHog when
  // `SENTRY_ENVIRONMENT` is unset, so an event's environment matches the
  // server's instead of Vite's build mode.
  APP_ENV: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  NO_INDEX: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().optional(),
  // Public by design: a Sentry DSN identifies a project, it does not
  // authorize ingestion of another. The server-side `SENTRY_ENVIRONMENT`
  // keeps test and production events apart.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
});

export type ServerPublicEnv = z.infer<typeof serverEnvSchema>;

export function getPublicEnvServer(): ServerPublicEnv {
  return serverEnvSchema.parse({
    API_URL: process.env.API_URL,
    APP_URL: process.env.APP_URL,
    APP_ROOT_DOMAIN: process.env.APP_ROOT_DOMAIN,
    APP_RELEASE: process.env.APP_RELEASE,
    APP_ENV: process.env.APP_ENV,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    NO_INDEX: process.env.NO_INDEX,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
  });
}

export function getServerRuntimePublicEnv() {
  const env = getPublicEnvServer();

  return {
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appRelease: env.APP_RELEASE,
    appEnv: env.APP_ENV,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    posthogKey: env.POSTHOG_KEY,
    posthogHost: env.POSTHOG_HOST,
    sentryDsn: env.SENTRY_DSN,
    sentryEnvironment: env.SENTRY_ENVIRONMENT,
  };
}

/**
 * The values injected into `window.global.__ENV`.
 *
 * In the dev server the browser talks to the API through the same-origin Vite
 * proxy (`vite.config.ts`) so auth cookies are first-party on `*.localhost`
 * subdomains. Server-side code keeps using the absolute API_URL; only the
 * injected browser-facing value is made origin-relative.
 */
export function getBrowserPublicEnv() {
  const env = getPublicEnvServer();

  return {
    API_URL: import.meta.env.DEV ? "/api" : env.API_URL,
    APP_URL: env.APP_URL,
    APP_ROOT_DOMAIN: env.APP_ROOT_DOMAIN,
    APP_RELEASE: env.APP_RELEASE,
    APP_ENV: env.APP_ENV,
    TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY,
    POSTHOG_KEY: env.POSTHOG_KEY,
    POSTHOG_HOST: env.POSTHOG_HOST,
    SENTRY_DSN: env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
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
