import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient as createVanillaAuthClientBase } from "better-auth/client";
import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  lastLoginMethodClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient as createAuthClientBase } from "better-auth/react";
import { z } from "zod";

import { clientTimeZoneHeader } from "./client-time-zone";
import {
  ORGANIZATION_ROLES,
  organizationAccessControl,
} from "./organization-roles";
import { jwtAutoLoginClient } from "./plugins/jwt-auto-login/client";
import type {
  Auth,
  AuthClientMembership,
  AuthClientOrganization,
} from "./server";

const buildAuthClientOptions = (
  baseURL: string,
  options?: { readonly getTimeZone?: () => string | undefined }
) => ({
  plugins: [
    customSessionClient<Auth>(),
    emailOTPClient(),
    organizationClient({
      ac: organizationAccessControl,
      roles: ORGANIZATION_ROLES,
    }),
    twoFactorClient(),
    adminClient(),
    // The sign-in page's "Last used" hint. The server half
    // (`lastLoginMethod({ storeInDatabase: true })`) is already enabled in
    // `server.ts`; this half exposes `getLastUsedLoginMethod()`, which reads
    // the `better-auth.last_used_login_method` cookie the server writes on
    // every sign-in. Without it the value is only readable by the next
    // authenticated request, which is no use on a signed-out page.
    lastLoginMethodClient(),
    // The MCP authorization server's endpoints (`oauth2.consent`,
    // `oauth2.continue`), used by the consent and workspace-choice pages.
    oauthProviderClient(),
    jwtAutoLoginClient(),
  ],
  baseURL,
  fetchOptions: {
    onRequest(context: any) {
      const timeZone = options?.getTimeZone?.();

      if (timeZone) {
        context.headers.set(clientTimeZoneHeader, timeZone);
      }

      return context;
    },
  },
});

export const createAuthClient = (
  baseURL: string,
  options?: { readonly getTimeZone?: () => string | undefined }
) => createAuthClientBase(buildAuthClientOptions(baseURL, options));

/**
 * Vanilla (non-React) auth client for server-side callers.
 *
 * The React client from `better-auth/react` pulls React into any bundle that
 * imports it — including the Cloudflare Worker's startup graph, where the
 * middleware only needs `getSession()`. Using this variant keeps React out of
 * server bundles entirely.
 */
export const createVanillaAuthClient = (
  baseURL: string,
  options?: { readonly getTimeZone?: () => string | undefined }
) => createVanillaAuthClientBase(buildAuthClientOptions(baseURL, options));

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
