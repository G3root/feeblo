type ProcessEnv = Record<string, string>;

function parseRuntimePublicEnv(env: ProcessEnv) {
  return {
    apiUrl: env.PUBLIC_API_URL,
    appUrl: env.PUBLIC_APP_URL,
    appRootDomain: env.PUBLIC_APP_ROOT_DOMAIN,
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
