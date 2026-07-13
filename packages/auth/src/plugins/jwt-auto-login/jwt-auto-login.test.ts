// CREDIT: https://github.com/better-auth/better-auth/blob/next/packages/better-auth/src/plugins/anonymous/anon.test.ts
/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
/** biome-ignore-all lint/suspicious/useAwait: <explanation> */

import type { GoogleProfile } from "@better-auth/core/social-providers";
import { signJWT } from "better-auth/crypto";
import { getTestInstance } from "better-auth/test";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { jwtAutoLoginClient } from "./client";
import { jwtAutoLogin } from "./plugin";

vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>();
  return {
    ...actual,
    getSessionFromCtx: vi.fn((...args: any[]) =>
      actual.getSessionFromCtx(...(args as [any, ...any[]]))
    ),
  };
});

function stripSessionCookie(
  headers: Headers,
  sessionCookiePrefix = "better-auth.session_token"
): Headers {
  const result = new Headers(headers);
  const kept = (headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(sessionCookiePrefix));
  result.delete("cookie");
  if (kept.length) {
    result.set("cookie", kept.join("; "));
  }
  return result;
}

const testSecret = "better-auth-secret-that-is-long-enough-for-validation-test";

let testIdToken: string;
let handlers: ReturnType<typeof http.post>[];

const server = setupServer();

beforeAll(async () => {
  const data: GoogleProfile = {
    email: "user@email.com",
    email_verified: true,
    name: "First Last",
    picture: "https://lh3.googleusercontent.com/a-/AOh14GjQ4Z7Vw",
    exp: 1_234_567_890,
    sub: "1234567890",
    iat: 1_234_567_890,
    aud: "test",
    azp: "test",
    nbf: 1_234_567_890,
    iss: "test",
    locale: "en",
    jti: "test",
    given_name: "First",
    family_name: "Last",
  };
  testIdToken = await signJWT(data, testSecret);

  handlers = [
    http.post("https://oauth2.googleapis.com/token", () => {
      return HttpResponse.json({
        access_token: "test",
        refresh_token: "test",
        id_token: testIdToken,
      });
    }),
  ];

  server.listen({ onUnhandledRequest: "bypass" });
  server.use(...handlers);
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  server.use(...handlers);
});

afterAll(() => server.close());

describe("jwtAutoLogin", async () => {
  const linkAccountFn = vi.fn();

  let _auth: any = null;

  const { client, sessionSetter, testUser, cookieSetter, auth } =
    await getTestInstance(
      {
        plugins: [
          jwtAutoLogin({
            async onLinkAccount(data) {
              linkAccountFn(data);
            },
            async createSsoUser({ organizationId }) {
              const ctx = await _auth.$context;
              const user = await ctx.internalAdapter.createUser({
                name: "Widget User",
                email: `widget-${organizationId}@example.com`,
                restrictedToOrganizationId: organizationId,
              });
              return { name: user.name, userId: user.id };
            },
          }),
        ],
      },
      {
        clientOptions: {
          plugins: [jwtAutoLoginClient()],
        },
      }
    );

  _auth = auth;

  const headers = new Headers();

  it("should sign in via JWT auto login", async () => {
    const testHeaders = new Headers();
    await client.signIn.jwtAutoLogin({
      organizationId: "org-1",
      token: "valid-jwt",
      fetchOptions: {
        onSuccess: sessionSetter(testHeaders),
      },
    });
    const session = await client.getSession({
      fetchOptions: { headers: testHeaders },
    });
    expect(session.data?.session).toBeDefined();
    expect(session.data?.user.restrictedToOrganizationId).toBe("org-1");
  });

  it("should reject subsequent JWT auto login when already signed in", async () => {
    const persistentHeaders = new Headers();

    await client.signIn.jwtAutoLogin({
      organizationId: "org-2",
      token: "valid-jwt",
      fetchOptions: {
        onSuccess: sessionSetter(persistentHeaders),
      },
    });

    const session = await client.getSession({
      fetchOptions: { headers: persistentHeaders },
    });
    expect(session.data?.session).toBeDefined();
    expect(session.data?.user.restrictedToOrganizationId).toBe("org-2");

    const secondAttempt = await client.signIn.jwtAutoLogin({
      organizationId: "org-2",
      token: "another-jwt",
      fetchOptions: { headers: persistentHeaders },
    });

    expect(secondAttempt.data).toBeNull();
    expect(secondAttempt.error).toBeDefined();
    expect(secondAttempt.error?.message).toBe(
      "Anonymous users cannot sign in again anonymously"
    );
  });

  it("should return error when createSsoUser fails", async () => {
    const { client: localClient } = await getTestInstance(
      {
        plugins: [
          jwtAutoLogin({
            async createSsoUser() {
              return { code: "INVALID_JWT" as const, message: "invalid token" };
            },
          }),
        ],
      },
      {
        clientOptions: {
          plugins: [jwtAutoLoginClient()],
        },
        disableTestUser: true,
      }
    );

    const res = await localClient.signIn.jwtAutoLogin({
      organizationId: "org-1",
      token: "bad-token",
    });

    expect(res.error?.code).toBe("INVALID_JWT");
    expect(res.error?.message).toBe("Invalid JWT");
  });

  it("should return error when organization has no JWT secret", async () => {
    const { client: localClient } = await getTestInstance(
      {
        plugins: [
          jwtAutoLogin({
            async createSsoUser() {
              return {
                code: "ORGANIZATION_HAS_NO_JWT_SECRET" as const,
              };
            },
          }),
        ],
      },
      {
        clientOptions: {
          plugins: [jwtAutoLoginClient()],
        },
        disableTestUser: true,
      }
    );

    const res = await localClient.signIn.jwtAutoLogin({
      organizationId: "org-1",
      token: "irrelevant",
    });

    expect(res.error?.code).toBe("ORGANIZATION_HAS_NO_JWT_SECRET");
  });

  it("should return error when token is missing email or name", async () => {
    const { client: localClient } = await getTestInstance(
      {
        plugins: [
          jwtAutoLogin({
            async createSsoUser() {
              return {
                code: "SSO_TOKEN_MISSING_EMAIL_OR_NAME" as const,
              };
            },
          }),
        ],
      },
      {
        clientOptions: {
          plugins: [jwtAutoLoginClient()],
        },
        disableTestUser: true,
      }
    );

    const res = await localClient.signIn.jwtAutoLogin({
      organizationId: "org-1",
      token: "incomplete",
    });

    expect(res.error?.code).toBe("SSO_TOKEN_MISSING_EMAIL_OR_NAME");
  });

  it("should link restricted user on email sign-in", async () => {
    const localHeaders = new Headers();
    await client.signIn.jwtAutoLogin({
      organizationId: "org-3",
      token: "valid-jwt",
      fetchOptions: {
        onSuccess: sessionSetter(localHeaders),
      },
    });

    expect(linkAccountFn).toHaveBeenCalledTimes(0);
    await client.signIn.email(testUser, { headers: localHeaders });
    expect(linkAccountFn).toHaveBeenCalledWith(expect.any(Object));
    linkAccountFn.mockClear();
  });

  it("should link restricted user on social sign-in", async () => {
    const localHeaders = new Headers();
    await client.signIn.jwtAutoLogin({
      organizationId: "org-4",
      token: "valid-jwt",
      fetchOptions: {
        onSuccess: sessionSetter(localHeaders),
      },
    });

    await client.getSession({
      fetchOptions: { headers: localHeaders },
    });

    const signInRes = await client.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
      fetchOptions: {
        onSuccess: cookieSetter(localHeaders),
      },
    });
    const state = new URL(signInRes.data?.url || "").searchParams.get("state");
    await client.$fetch("/callback/google", {
      query: { state, code: "test" },
      headers: localHeaders,
    });
    expect(linkAccountFn).toHaveBeenCalledWith(expect.any(Object));
  });

  /**
   * @see https://github.com/better-auth/better-auth/issues/8692
   */
  it("should link on social callback without session cookie (Expo)", async () => {
    linkAccountFn.mockClear();
    const anonHeaders = new Headers();
    await client.signIn.jwtAutoLogin({
      organizationId: "org-expo",
      token: "valid-jwt",
      fetchOptions: { onSuccess: sessionSetter(anonHeaders) },
    });
    const session = await client.getSession({
      fetchOptions: { headers: anonHeaders },
    });
    expect(session.data?.user.restrictedToOrganizationId).toBe("org-expo");

    const signInRes = await client.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
      fetchOptions: {
        onSuccess: cookieSetter(anonHeaders),
        headers: anonHeaders,
      },
    });
    const state = new URL(signInRes.data?.url || "").searchParams.get("state");

    await client.$fetch("/callback/google", {
      query: { state, code: "test" },
      headers: stripSessionCookie(anonHeaders),
    });

    expect(linkAccountFn).toHaveBeenCalledWith(expect.any(Object));
  });

  it("should ignore client-supplied autoLoginUserId on OAuth callback", async () => {
    linkAccountFn.mockClear();

    const victimHeaders = new Headers();
    const victim = await client.signIn.jwtAutoLogin({
      organizationId: "org-victim",
      token: "valid-jwt",
      fetchOptions: { onSuccess: sessionSetter(victimHeaders) },
    });
    const victimId = victim.data?.user.id;
    expect(victimId).toBeTruthy();

    const attackerHeaders = new Headers();
    const signInRes = await client.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
      additionalData: { autoLoginUserId: victimId },
      fetchOptions: {
        onSuccess: cookieSetter(attackerHeaders),
        headers: attackerHeaders,
      },
    });
    const state = new URL(signInRes.data?.url || "").searchParams.get("state");
    await client.$fetch("/callback/google", {
      query: { state, code: "test" },
      headers: attackerHeaders,
    });

    expect(linkAccountFn).not.toHaveBeenCalled();
    const ctx = await auth.$context;
    const stillThere = await ctx.internalAdapter.findUserById(victimId!);
    expect(stillThere?.id).toBe(victimId);
  });

  it("should call onLinkAccount when restricted user verifies email", async () => {
    /**
     * @see https://github.com/better-auth/better-auth/issues/9485
     */
    const linkAccountFnLocal = vi.fn();
    let verificationToken = "";

    let _localAuth: any = null;

    const {
      client: localClient,
      sessionSetter: localSessionSetter,
      auth: localAuth,
    } = await getTestInstance(
      {
        plugins: [
          jwtAutoLogin({
            async onLinkAccount(data) {
              linkAccountFnLocal(data);
            },
            async createSsoUser({ organizationId }) {
              const ctx = await _localAuth.$context;
              const user = await ctx.internalAdapter.createUser({
                name: "Widget User",
                email: `widget-verify-${organizationId}@example.com`,
                restrictedToOrganizationId: organizationId,
              });
              return { name: user.name, userId: user.id };
            },
          }),
        ],
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
        },
        emailVerification: {
          autoSignInAfterVerification: true,
          async sendVerificationEmail({ url }) {
            verificationToken = new URL(url).searchParams.get("token") || "";
          },
        },
      },
      {
        clientOptions: {
          plugins: [jwtAutoLoginClient()],
        },
        disableTestUser: true,
      }
    );

    _localAuth = localAuth;

    const anonHeaders = new Headers();
    await localClient.signIn.jwtAutoLogin({
      organizationId: "org-verify",
      token: "valid-jwt",
      fetchOptions: { onSuccess: localSessionSetter(anonHeaders) },
    });

    await localAuth.api.signUpEmail({
      body: {
        email: "newuser@example.com",
        password: "password123",
        name: "New User",
      },
      headers: anonHeaders,
    });

    await localAuth.api.verifyEmail({
      query: { token: verificationToken },
      headers: anonHeaders,
    });

    expect(linkAccountFnLocal).toHaveBeenCalledTimes(1);
    expect(linkAccountFnLocal).toHaveBeenCalledWith(expect.any(Object));
  });

  describe("cleanup safeguards", () => {
    function createMiddlewareContext({
      newSessionUser,
      deleteUser,
      deleteUserSessions,
    }: {
      newSessionUser: Record<string, any>;
      deleteUser: ReturnType<typeof vi.fn>;
      deleteUserSessions?: ReturnType<typeof vi.fn>;
    }) {
      return {
        path: "/sign-in/jwt-auto-login",
        context: {
          responseHeaders: new Headers({
            "set-cookie":
              "better-auth.session_token=new-token.value; Path=/; HttpOnly",
          }),
          authCookies: {
            sessionToken: {
              name: "better-auth.session_token",
              options: {},
            },
            sessionData: {
              name: "better-auth.session_data",
              options: {},
            },
            dontRememberToken: {
              name: "better-auth.dont_remember",
              options: {},
            },
          },
          newSession: {
            user: newSessionUser,
            session: {
              token: "new-token",
            },
          },
          internalAdapter: {
            deleteUser,
            deleteUserSessions: deleteUserSessions ?? vi.fn(),
          },
          options: {},
          secret: "secret",
          setNewSession: vi.fn(),
        },
        headers: new Headers(),
        query: {},
        error: vi.fn(),
        json: vi.fn(),
        getSignedCookie: vi.fn(),
        setCookie: vi.fn(),
        setSignedCookie: vi.fn(),
      } as any;
    }

    it("does not delete when the new session is still restricted", async () => {
      const { getSessionFromCtx } = await import("better-auth/api");
      const plugin = jwtAutoLogin({
        createSsoUser: vi.fn(),
      });
      const handler = plugin.hooks?.after?.[0]?.handler;
      const deleteUser = vi.fn();
      const ctx = createMiddlewareContext({
        newSessionUser: {
          id: "restricted-user",
          restrictedToOrganizationId: "org-1",
        },
        deleteUser,
      });

      vi.mocked(getSessionFromCtx).mockResolvedValue({
        user: {
          id: "restricted-user",
          restrictedToOrganizationId: "org-1",
        },
        session: {
          token: "old-token",
        },
      } as any);

      await handler?.(ctx);

      expect(deleteUser).not.toHaveBeenCalled();
    });

    it("deletes the previous restricted user when linking a new account", async () => {
      const { getSessionFromCtx } = await import("better-auth/api");
      const plugin = jwtAutoLogin({
        createSsoUser: vi.fn(),
      });
      const handler = plugin.hooks?.after?.[0]?.handler;
      const deleteUser = vi.fn();
      const deleteUserSessions = vi.fn();
      const ctx = createMiddlewareContext({
        newSessionUser: {
          id: "linked-user",
          restrictedToOrganizationId: null,
        },
        deleteUser,
        deleteUserSessions,
      });

      vi.mocked(getSessionFromCtx).mockResolvedValue({
        user: {
          id: "restricted-user",
          restrictedToOrganizationId: "org-1",
        },
        session: {
          token: "old-token",
        },
      } as any);

      await handler?.(ctx);

      expect(deleteUserSessions).toHaveBeenCalledWith("restricted-user");
      expect(deleteUser).toHaveBeenCalledWith("restricted-user");
    });
  });
});
