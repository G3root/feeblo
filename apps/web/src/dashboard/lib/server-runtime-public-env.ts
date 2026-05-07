import { z } from "zod";

const runtimePublicEnvSchema = z.object({
  apiUrl: z.url(),
  appUrl: z.url(),
  appRootDomain: z.string().min(1),
});

type ProcessEnv = Record<string, string | undefined>;

export type RuntimePublicEnv = z.infer<typeof runtimePublicEnvSchema>;

export function getPublicEnv(): ProcessEnv {
  return {
    PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL,
    PUBLIC_APP_URL: import.meta.env.PUBLIC_APP_URL,
    PUBLIC_APP_ROOT_DOMAIN: import.meta.env.PUBLIC_APP_ROOT_DOMAIN,
  };
}

export function getServerRuntimePublicEnv(): RuntimePublicEnv {
  return runtimePublicEnvSchema.parse({
    apiUrl: import.meta.env.PUBLIC_API_URL,
    appUrl: import.meta.env.PUBLIC_APP_URL,
    appRootDomain: import.meta.env.PUBLIC_APP_ROOT_DOMAIN,
  });
}
