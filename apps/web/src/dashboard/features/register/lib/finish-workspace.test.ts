import { describe, expect, it, vi } from "vitest";

import { type FinishWorkspaceDeps, finishWorkspace } from "./finish-workspace";

/**
 * The post-create work, which the e2e stack cannot run end to end: its API
 * server has no object storage, so the logo endpoint answers 500 there.
 *
 * What matters here is that neither a refused upload nor a refused invitation
 * is allowed to escape. The workspace exists by the time this runs, so every
 * failure is a warning the wizard reports, not an error that hides the
 * workspace the reader just made.
 */

const logo = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", {
    type: "image/png",
  });

const accepted = () => Promise.resolve({ error: null });

describe("finishWorkspace", () => {
  it("uploads the logo and invites everyone", async () => {
    const uploadLogo = vi.fn(async () => true);
    const invite = vi.fn(accepted);

    const result = await finishWorkspace(
      {
        invites: ["one@example.com", "two@example.com"],
        logo: logo(),
        organizationId: "org_1",
      },
      { invite, uploadLogo }
    );

    expect(result).toStrictEqual({
      failedInvites: [],
      invited: ["one@example.com", "two@example.com"],
      logoUploaded: true,
    });
    expect(uploadLogo).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledTimes(2);
  });

  it("reports a refused upload without failing the workspace", async () => {
    const result = await finishWorkspace(
      {
        invites: ["one@example.com"],
        logo: logo(),
        organizationId: "org_1",
      },
      { invite: async () => ({ error: null }), uploadLogo: async () => false }
    );

    expect(result.logoUploaded).toBe(false);
    expect(result.invited).toStrictEqual(["one@example.com"]);
  });

  it("records an invitation the server refused, and carries on", async () => {
    const invite = vi.fn(
      async (input: { email: string; organizationId: string }) => ({
        error:
          input.email === "refused@example.com" ? { message: "taken" } : null,
      })
    );

    const result = await finishWorkspace(
      {
        invites: ["refused@example.com", "accepted@example.com"],
        logo: null,
        organizationId: "org_1",
      },
      { invite, uploadLogo: async () => false }
    );

    expect(result.failedInvites).toStrictEqual(["refused@example.com"]);
    expect(result.invited).toStrictEqual(["accepted@example.com"]);
  });

  it("records an invitation that throws, and carries on", async () => {
    const invite = vi.fn(
      async (input: { email: string; organizationId: string }) => {
        if (input.email === "exploded@example.com") {
          throw new Error("boom");
        }

        return { error: null };
      }
    );

    const result = await finishWorkspace(
      {
        invites: ["exploded@example.com", "accepted@example.com"],
        logo: null,
        organizationId: "org_1",
      },
      { invite, uploadLogo: async () => false }
    );

    // A throw used to reject the actor, which sent the machine to `done` with
    // no invitation results at all, losing the ones already sent.
    expect(result.failedInvites).toStrictEqual(["exploded@example.com"]);
    expect(result.invited).toStrictEqual(["accepted@example.com"]);
  });

  it("does nothing when there is no logo and nobody to invite", async () => {
    const deps: FinishWorkspaceDeps = {
      invite: vi.fn(accepted),
      uploadLogo: vi.fn(async () => true),
    };

    const result = await finishWorkspace(
      { invites: [], logo: null, organizationId: "org_1" },
      deps
    );

    expect(result).toStrictEqual({
      failedInvites: [],
      invited: [],
      logoUploaded: false,
    });
    expect(deps.invite).not.toHaveBeenCalled();
    expect(deps.uploadLogo).not.toHaveBeenCalled();
  });
});
