import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient as createAuthClientBase } from "better-auth/react";
import type { Auth } from "./server";

export const createAuthClient = (baseURL: string) => {
  return createAuthClientBase({
    plugins: [
      customSessionClient<Auth>(),
      inferAdditionalFields<Auth>(),
      emailOTPClient(),
      organizationClient(),
      twoFactorClient(),
      adminClient(),
    ],
    baseURL,
  });
};

export type TAuthClient = ReturnType<typeof createAuthClient>;
