export function getPublicEnvServer() {
  return {
    PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL as string,
    PUBLIC_APP_URL: import.meta.env.PUBLIC_APP_URL as string,
    PUBLIC_APP_ROOT_DOMAIN: import.meta.env.PUBLIC_APP_ROOT_DOMAIN as string,
  };
}

export function getServerRuntimePublicEnv() {
  const env = getPublicEnvServer();
  return {
    apiUrl: env.PUBLIC_API_URL,
    appUrl: env.PUBLIC_APP_URL,
    appRootDomain: env.PUBLIC_APP_ROOT_DOMAIN,
  };
}
