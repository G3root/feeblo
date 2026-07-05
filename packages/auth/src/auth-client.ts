import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient as createAuthClientBase } from "better-auth/react";
import { z } from "zod";
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

export type AuthClientMembership = {
  membershipId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  userId: string;
};

export type AuthClientOrganization = {
  id: string;
};

export type TAuthClient = ReturnType<typeof createAuthClient>;
export type AuthClientSession = NonNullable<
  TAuthClient["$Infer"]["Session"]
> & {
  memberships: AuthClientMembership[];
  organizations: AuthClientOrganization[];
};
export type AuthClientSessionData = AuthClientSession["session"];
export type AuthClientUser = AuthClientSession["user"];

export const authStateSchema = z.object({
  id: z.string(),
  session: z.custom<AuthClientSessionData | null>(),
  user: z.custom<AuthClientUser | null>(),
  memberships: z.custom<AuthClientMembership[]>(),
  organizations: z.custom<AuthClientOrganization[]>(),
});
