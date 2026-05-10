type ProcessEnv = Record<string, string>;

function parseRuntimePublicEnv(env: ProcessEnv) {
  return {
    apiUrl: env.API_URL,
    appUrl: env.APP_URL,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appRelease: env.APP_RELEASE ?? "unknown",
  };
}

function readClientRuntimePublicEnv() {
  const runtimeWindow = window as Window & {
    global?: { __ENV?: ProcessEnv };
  };

  return parseRuntimePublicEnv(runtimeWindow.global?.__ENV ?? {});
}

export function getRuntimePublicEnv() {
  return readClientRuntimePublicEnv();
}
