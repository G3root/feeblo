import { createPrivateKey } from "node:crypto";

import {
  IntegrationProviderInvalidConfigurationError,
  IntegrationProviderTemporaryFailure,
} from "@feeblo/integration-core";
import * as Cache from "effect/Cache";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as jose from "jose";

import type { GitHubApiClient } from "./github-api";
import type { GitHubApiFailure } from "./github-errors";
import { githubProviderKey } from "./github-manifest";

/** GitHub permits App JWTs for at most ten minutes. */
export const GITHUB_APP_JWT_LIFETIME_SECONDS = 9 * 60;
/** Leave room for transit and clock skew before reusing an installation token. */
export const GITHUB_INSTALLATION_TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** Signs the short-lived RS256 JWT used solely to mint GitHub App installation tokens. */
export const createGitHubAppJwt = ({
  appId,
  now,
  privateKey,
}: {
  readonly appId: string;
  readonly now: Date;
  readonly privateKey: Redacted.Redacted<string>;
}): Effect.Effect<
  Redacted.Redacted<string>,
  IntegrationProviderInvalidConfigurationError
> =>
  Effect.tryPromise({
    try: async () => {
      const normalizedPrivateKey = createPrivateKey(
        Redacted.value(privateKey)
      ).export({ format: "pem", type: "pkcs8" });
      const key = await jose.importPKCS8(
        normalizedPrivateKey.toString(),
        "RS256"
      );
      return new jose.SignJWT({})
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuedAt(Math.floor(now.getTime() / 1000) - 60)
        .setIssuer(appId)
        .setExpirationTime(
          Math.floor(now.getTime() / 1000) + GITHUB_APP_JWT_LIFETIME_SECONDS
        )
        .sign(key);
    },
    catch: () =>
      new IntegrationProviderInvalidConfigurationError({
        message: "GitHub App private key is invalid.",
        provider: githubProviderKey,
      }),
  }).pipe(Effect.map(Redacted.make));

/** Mints and bounds in-memory reuse of ephemeral installation tokens; tokens never enter persistence. */
export interface GitHubInstallationTokenResolver {
  readonly getInstallationAccessToken: (input: {
    readonly installationId: string;
  }) => Effect.Effect<
    Redacted.Redacted<string>,
    GitHubApiFailure | IntegrationProviderInvalidConfigurationError
  >;
}

/** Creates one server-lifetime bounded cache for GitHub App installation tokens. */
export const makeGitHubInstallationTokenResolver = ({
  apiClient,
  appId,
  now = () => new Date(),
  privateKey,
}: {
  readonly apiClient: GitHubApiClient;
  readonly appId: string;
  readonly now?: () => Date;
  readonly privateKey: Redacted.Redacted<string>;
}): Effect.Effect<GitHubInstallationTokenResolver, never> =>
  Effect.gen(function* () {
    const tokenCache = yield* Cache.makeWith(
      (installationId: string) =>
        Effect.gen(function* () {
          const appJwt = yield* createGitHubAppJwt({
            appId,
            now: now(),
            privateKey,
          });
          const minted = yield* apiClient.createInstallationAccessToken({
            appJwt,
            installationId,
          });
          if (
            minted.expires_at.getTime() <=
            now().getTime() + GITHUB_INSTALLATION_TOKEN_EXPIRY_SKEW_MS
          ) {
            return yield* new IntegrationProviderTemporaryFailure({
              message:
                "GitHub returned an installation token that expires too soon.",
              provider: githubProviderKey,
            });
          }
          return {
            expiresAt: minted.expires_at,
            token: Redacted.make(minted.token),
          };
        }),
      {
        capacity: 1000,
        timeToLive: (exit) => {
          if (Exit.isFailure(exit)) {
            return 0;
          }
          return Math.max(
            0,
            exit.value.expiresAt.getTime() -
              now().getTime() -
              GITHUB_INSTALLATION_TOKEN_EXPIRY_SKEW_MS
          );
        },
      }
    );
    return {
      getInstallationAccessToken: (input) =>
        Cache.get(tokenCache, input.installationId).pipe(
          Effect.map((entry) => entry.token)
        ),
    };
  });
