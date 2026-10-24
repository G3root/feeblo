import { hasWindow } from "@feeblo/utils/runtime-kind";

type ProcessEnv = Record<string, string>;

function parseRuntimePublicEnv(env: ProcessEnv) {
  return {
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appRelease: env.APP_RELEASE ?? "unknown",
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    posthogKey: env.POSTHOG_KEY,
    posthogHost: env.POSTHOG_HOST,
    sentryDsn: env.SENTRY_DSN,
    // `.env.example` leaves these blank, and an empty label is not a useful
    // environment; treat it as unset so the app-env and mode fallbacks run.
    sentryEnvironment: env.SENTRY_ENVIRONMENT || undefined,
    appEnv: env.APP_ENV || undefined,
  };
}

function readClientRuntimePublicEnv() {
  if (!hasWindow()) {
    return parseRuntimePublicEnv({});
  }

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const runtimeWindow = window as Window & {
    global?: { __ENV?: ProcessEnv };
  };

  return parseRuntimePublicEnv(runtimeWindow.global?.__ENV ?? {});
}

export function getRuntimePublicEnv() {
  return readClientRuntimePublicEnv();
}
