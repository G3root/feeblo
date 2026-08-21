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

import { render } from "vitest-browser-react";

import {
  overrideSessionGetterForTests,
  resetSessionGetterForTests,
} from "./atoms";
import { AuthProvider, useAuth } from "./auth-context";

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
      <AuthProvider>
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
});
