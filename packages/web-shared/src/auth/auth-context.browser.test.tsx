import { afterEach, describe, expect, it, vi } from "vitest";

// Session transport is overridden through the atom's test seam below; setting
// the runtime env keeps the (otherwise unused) authClient construction valid
// when the auth modules are imported.
vi.hoisted(() => {
  // SAFETY: the browser-test global carries the runtime env the SDK reads
  // from window.global.__ENV when the auth modules are imported.
  const globalWindow = window as Window & {
    global?: { __ENV?: Record<string, string> };
  };
  globalWindow.global = globalWindow.global ?? {};
  globalWindow.global.__ENV = { API_URL: "http://localhost:3000/api" };
});

import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { render } from "vitest-browser-react";

import {
  overrideSessionGetterForTests,
  resetSessionGetterForTests,
} from "./atoms";
import { AuthProvider, useAuth } from "./auth-context";
import { clearAuthHintCookie, writeAuthHintToCookie } from "./hint-cookie";

function AuthProbe() {
  const auth = useAuth();
  const value =
    auth.status === "authenticated"
      ? `authenticated:${auth.user.email}`
      : auth.status;

  return <output>{value}</output>;
}

describe("AuthProvider session revalidation", () => {
  afterEach(() => {
    resetSessionGetterForTests();
    clearAuthHintCookie();
  });

  it("revalidates on window focus without signing out after a transient failure", async () => {
    const responses: Array<
      () => Promise<
        | {
            data: { user: { email: string; image: null; name: string } };
            error: null;
          }
        | { data: null; error: { message: string } }
      >
    > = [
      async () => ({
        data: {
          user: { email: "person@example.com", image: null, name: "Person" },
        },
        error: null,
      }),
      async () => ({ data: null, error: { message: "Network unavailable" } }),
    ];
    let callIndex = 0;
    const getSession = vi.fn(() => responses[callIndex++]());

    overrideSessionGetterForTests(getSession);

    const screen = await render(
      <AuthProvider registry={AtomRegistry.make()}>
        <AuthProbe />
      </AuthProvider>
    );
    const authenticated = screen.getByText("authenticated:person@example.com");

    await expect.element(authenticated).toBeVisible();

    window.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => {
      expect(getSession).toHaveBeenCalledTimes(2);
    });
    await expect.element(authenticated).toBeVisible();
  });

  it("paints the cached hint while the session request is in flight", async () => {
    writeAuthHintToCookie({
      email: "cached@example.com",
      image: null,
      name: "Cached",
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    overrideSessionGetterForTests(() =>
      gate.then(() => ({
        data: {
          user: { email: "fresh@example.com", image: null, name: "Fresh" },
        },
        error: null,
      }))
    );

    const screen = await render(
      <AuthProvider registry={AtomRegistry.make()}>
        <AuthProbe />
      </AuthProvider>
    );

    // The cached identity paints synchronously, before the atom resolves.
    await expect
      .element(screen.getByText("authenticated:cached@example.com"))
      .toBeVisible();

    release!();
    await vi.waitFor(() => {
      screen.getByText("authenticated:fresh@example.com");
    });
    await expect
      .element(screen.getByText("authenticated:fresh@example.com"))
      .toBeVisible();
  });

  it("clears the hint cookie after a confirmed sign-out", async () => {
    writeAuthHintToCookie({
      email: "cached@example.com",
      image: null,
      name: "Cached",
    });
    overrideSessionGetterForTests(async () => ({ data: null, error: null }));

    const screen = await render(
      <AuthProvider registry={AtomRegistry.make()}>
        <AuthProbe />
      </AuthProvider>
    );

    await expect.element(screen.getByText("unauthenticated")).toBeVisible();
    expect(document.cookie).not.toContain("feeblo_auth_hint");
  });
});
