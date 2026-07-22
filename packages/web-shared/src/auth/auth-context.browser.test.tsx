import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AuthProvider, useAuth } from "./auth-context";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../lib/auth-client", () => ({
  authClient: { getSession },
}));

function AuthProbe() {
  const auth = useAuth();
  const value =
    auth.status === "authenticated"
      ? `authenticated:${auth.user.email}`
      : auth.status;

  return <output>{value}</output>;
}

describe("AuthProvider session revalidation", () => {
  it("revalidates on window focus without signing out after a transient failure", async () => {
    getSession
      .mockResolvedValueOnce({
        data: {
          user: {
            email: "person@example.com",
            image: null,
            name: "Person",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Network unavailable" },
      });

    const screen = await render(
      <AuthProvider initialHint={null}>
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
