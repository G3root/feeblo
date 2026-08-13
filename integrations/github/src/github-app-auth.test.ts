import { generateKeyPairSync } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as jose from "jose";
import { describe, expect, it } from "vitest";
import type { GitHubApiClient } from "./github-api";
import {
  createGitHubAppJwt,
  makeGitHubInstallationTokenResolver,
} from "./github-app-auth";

const makePrivateKey = () =>
  Effect.tryPromise(async () => {
    const keys = await jose.generateKeyPair("RS256", { extractable: true });
    return jose.exportPKCS8(keys.privateKey);
  });

describe("GitHub App authentication", () => {
  it("creates a short-lived RS256 App JWT with GitHub-required claims", async () => {
    const privateKey = await Effect.runPromise(makePrivateKey());
    const now = new Date("2030-01-01T00:00:00Z");
    const token = await Effect.runPromise(
      createGitHubAppJwt({
        appId: "1234",
        now,
        privateKey: Redacted.make(privateKey),
      })
    );
    const protectedHeader = jose.decodeProtectedHeader(Redacted.value(token));
    const claims = jose.decodeJwt(Redacted.value(token));
    expect(protectedHeader.alg).toBe("RS256");
    expect(claims.iss).toBe("1234");
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000) - 60);
    expect(claims.exp).toBeLessThanOrEqual(
      Math.floor(now.getTime() / 1000) + 600
    );
  });

  it("accepts the PKCS#1 private key format downloaded from GitHub", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const result = await Effect.runPromise(
      createGitHubAppJwt({
        appId: "1234",
        now: new Date("2030-01-01T00:00:00Z"),
        privateKey: Redacted.make(privateKey),
      })
    );
    expect(jose.decodeProtectedHeader(Redacted.value(result)).alg).toBe(
      "RS256"
    );
  });

  it("caches an installation token until its safety skew", async () => {
    const privateKey = await Effect.runPromise(makePrivateKey());
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
    const resolver = await Effect.runPromise(
      makeGitHubInstallationTokenResolver({
        apiClient,
        appId: "1234",
        now: () => now,
        privateKey: Redacted.make(privateKey),
      })
    );
    const [first, second] = await Effect.runPromise(
      Effect.all([
        resolver.getInstallationAccessToken({ installationId: "9" }),
        resolver.getInstallationAccessToken({ installationId: "9" }),
      ])
    );
    expect(Redacted.value(first)).toBe("ghs_token_1");
    expect(Redacted.value(second)).toBe("ghs_token_1");
    expect(minted).toBe(1);
  });
});
