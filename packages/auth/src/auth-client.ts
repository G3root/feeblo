import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient as createAuthClientBase } from "better-auth/react";
import { createAuthClient as createSolidAuthClientBase } from "better-auth/solid";
import type { Auth } from "./server";

const plugins = [
  customSessionClient<Auth>(),
  emailOTPClient(),
  organizationClient(),
  twoFactorClient(),
  adminClient(),
];

export const createAuthClient = (baseURL: string) => {
  return createAuthClientBase({
    plugins,
    baseURL,
  });
};

export type TAuthClient = ReturnType<typeof createAuthClient>;

export const createSolidAuthClient = (baseURL: string) => {
  return createSolidAuthClientBase({
    plugins,
    baseURL,
  });
};
