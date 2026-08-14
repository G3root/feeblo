import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as jose from "jose";
import type { GitHubApiClient } from "./github-api";
import {
  createGitHubAppJwt,
  makeGitHubInstallationTokenResolver,
} from "./github-app-auth";

const makePrivateKey = () =>
  Effect.tryPromise(() =>
    jose
      .generateKeyPair("RS256", { extractable: true })
      .then((keys) => jose.exportPKCS8(keys.privateKey))
  );

describe("GitHub App authentication", () => {
  it.effect(
    "creates a short-lived RS256 App JWT with GitHub-required claims",
    () =>
      Effect.gen(function* () {
        const privateKey = yield* makePrivateKey();
        const now = new Date("2030-01-01T00:00:00Z");
        const token = yield* createGitHubAppJwt({
          appId: "1234",
          now,
          privateKey: Redacted.make(privateKey),
        });
        const protectedHeader = jose.decodeProtectedHeader(
          Redacted.value(token)
        );
        const claims = jose.decodeJwt(Redacted.value(token));
        expect(protectedHeader.alg).toBe("RS256");
        expect(claims.iss).toBe("1234");
        expect(claims.iat).toBe(Math.floor(now.getTime() / 1000) - 60);
        expect(claims.exp).toBeLessThanOrEqual(
          Math.floor(now.getTime() / 1000) + 600
        );
      })
  );

  it.effect(
    "accepts the PKCS#1 private key format downloaded from GitHub",
    () =>
      Effect.gen(function* () {
        const { privateKey } = generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: { format: "pem", type: "pkcs1" },
          publicKeyEncoding: { format: "pem", type: "spki" },
        });
        const result = yield* createGitHubAppJwt({
          appId: "1234",
          now: new Date("2030-01-01T00:00:00Z"),
          privateKey: Redacted.make(privateKey),
        });
        expect(jose.decodeProtectedHeader(Redacted.value(result)).alg).toBe(
          "RS256"
        );
      })
  );

  it.effect("caches an installation token until its safety skew", () =>
    Effect.gen(function* () {
      const privateKey = yield* makePrivateKey();
      const now = new Date("2030-01-01T00:00:00Z");
      let minted = 0;
      const apiClient: GitHubApiClient = {
        createInstallationAccessToken: () => {
          minted += 1;
          return Effect.succeed({
            expires_at: new Date(now.getTime() + 60 * 60 * 1000),
            token: `ghs_token_${minted}`,
          });
        },
        createIssue: () => Effect.die("unused"),
        createIssueBacklinkComment: () => Effect.die("unused"),
        deleteInstallation: () => Effect.die("unused"),
        exchangeUserAccessToken: () => Effect.die("unused"),
        getIssue: () => Effect.die("unused"),
        listInstallationRepositories: () => Effect.die("unused"),
        listUserInstallations: () => Effect.die("unused"),
      };
      const resolver = yield* makeGitHubInstallationTokenResolver({
        apiClient,
        appId: "1234",
        now: () => now,
        privateKey: Redacted.make(privateKey),
      });
      const [first, second] = yield* Effect.all([
        resolver.getInstallationAccessToken({ installationId: "9" }),
        resolver.getInstallationAccessToken({ installationId: "9" }),
      ]);
      expect(Redacted.value(first)).toBe("ghs_token_1");
      expect(Redacted.value(second)).toBe("ghs_token_1");
      expect(minted).toBe(1);
    })
  );
});
