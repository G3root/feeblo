import { z } from "zod";

const runtimePublicEnvSchema = z.object({
  apiUrl: z.url(),
  appUrl: z.url(),
  appRootDomain: z.string().min(1),
});

export type RuntimePublicEnv = z.infer<typeof runtimePublicEnvSchema>;

type ProcessEnv = Record<string, string | undefined>;

function parseRuntimePublicEnv(env: ProcessEnv): RuntimePublicEnv {
  return runtimePublicEnvSchema.parse({
    apiUrl: env.PUBLIC_API_URL,
    appUrl: env.PUBLIC_APP_URL,
    appRootDomain: env.PUBLIC_APP_ROOT_DOMAIN,
  });
}

function readClientRuntimePublicEnv(): RuntimePublicEnv {
  const runtimeWindow = window as Window & {
    global?: { __ENV?: ProcessEnv };
  };

  return parseRuntimePublicEnv(runtimeWindow.global?.__ENV ?? {});
}

export function getRuntimePublicEnv(): RuntimePublicEnv {
  return readClientRuntimePublicEnv();
}
