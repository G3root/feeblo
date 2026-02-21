import {
  adminClient,
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient as createAuthClientBase } from "better-auth/react";
import type { Auth } from "./server";

export const createAuthClient = () => {
  return createAuthClientBase({
    plugins: [
      inferAdditionalFields<Auth>(),
      emailOTPClient(),
      organizationClient(),
      twoFactorClient(),
      adminClient(),
    ],
    baseURL: import.meta.env.VITE_API_URL,
  });
};

export type TAuthClient = ReturnType<typeof createAuthClient>;
