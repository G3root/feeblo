import { getSecret } from "astro:env/server";

export function getPublicEnvServer() {
  return {
    API_URL: getSecret("API_URL") as string,
    APP_URL: getSecret("APP_URL") as string,
    APP_ROOT_DOMAIN: getSecret("APP_ROOT_DOMAIN") as string,
    APP_RELEASE: getSecret("APP_RELEASE") as string,
    TURNSTILE_SITE_KEY: getSecret("TURNSTILE_SITE_KEY") as string | undefined,
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
  };
}
