import { getSecret } from "astro:env/server";

export function getPublicEnvServer() {
  return {
    PUBLIC_API_URL: getSecret("PUBLIC_API_URL") as string,
    PUBLIC_APP_URL: getSecret("PUBLIC_APP_URL") as string,
    PUBLIC_APP_ROOT_DOMAIN: getSecret("PUBLIC_APP_ROOT_DOMAIN") as string,
    PUBLIC_APP_RELEASE: getSecret("PUBLIC_APP_RELEASE") as string,
  };
}

export function getServerRuntimePublicEnv() {
  const env = getPublicEnvServer();
  return {
    apiUrl: env.PUBLIC_API_URL,
    appUrl: env.PUBLIC_APP_URL,
    appRootDomain: env.PUBLIC_APP_ROOT_DOMAIN,
    appRelease: env.PUBLIC_APP_RELEASE,
  };
}
