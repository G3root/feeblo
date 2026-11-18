import {
  authClient,
  organizationLogoUploadEndpoint,
} from "@feeblo/web-shared/auth-client";

import type {
  FinishWorkspacePayload,
  FinishWorkspaceResult,
} from "./register-wizard-machine";

/**
 * The two calls the post-create work makes.
 *
 * Injected rather than reached for, so the behaviour below can be tested
 * without standing up an auth client or an object store: the interesting part
 * is what happens when one of them fails, and a fake is the only way to make
 * that happen on purpose.
 */
export type FinishWorkspaceDeps = {
  /** Sends one invitation. A non-null `error` means the server refused it. */
  readonly invite: (input: {
    readonly email: string;
    readonly organizationId: string;
  }) => Promise<{ readonly error: unknown }>;
  /** Applies the logo. `false` means it did not land. */
  readonly uploadLogo: (input: {
    readonly file: File;
    readonly organizationId: string;
  }) => Promise<boolean>;
};

const liveDeps: FinishWorkspaceDeps = {
  invite: async ({ email, organizationId }) => {
    const result = await authClient.organization.inviteMember({
      email,
      organizationId,
      // The least privilege an invitation can carry. Onboarding is the wrong
      // moment to hand someone management rights, and the owner can raise the
      // role from settings once they know what the person should do.
      role: "contributor",
    });

    return { error: result.error };
  },
  uploadLogo: async ({ file, organizationId }) => {
    const body = new FormData();
    body.set("file", file);
    body.set("organizationId", organizationId);

    try {
      const response = await fetch(organizationLogoUploadEndpoint, {
        body,
        credentials: "include",
        method: "POST",
      });

      return response.ok;
    } catch {
      return false;
    }
  },
};

/**
 * The work that happens after the workspace exists: the logo, then the
 * invitations.
 *
 * Both need an organization id, which is why neither can be part of the create
 * call: the logo endpoint stores under the workspace, and better-auth will not
 * invite anyone to a workspace that does not exist yet.
 *
 * Neither failure is allowed to escape. The workspace is already created, so a
 * logo that would not upload and an invitation the server refused are both
 * things the reader can retry from settings, and the wizard reports them in its
 * summary rather than failing a create that has already happened.
 */
export async function finishWorkspace(
  { invites, logo, organizationId }: FinishWorkspacePayload,
  deps: FinishWorkspaceDeps = liveDeps
): Promise<FinishWorkspaceResult> {
  // Independent of each other, so they go together: the reader is waiting on
  // both, and one has no bearing on the other's request.
  const [invitations, logoUploaded] = await Promise.all([
    sendInvites({ deps, invites, organizationId }),
    logo === null
      ? Promise.resolve(false)
      : deps.uploadLogo({ file: logo, organizationId }),
  ]);

  return {
    failedInvites: invitations.failed,
    invited: invitations.invited,
    logoUploaded,
  };
}

/**
 * Sends one invitation per address, sequentially.
 *
 * One call at a time because each invitation takes a seat, and the member
 * limit is checked per call: a burst would race itself and report the cap as a
 * failure on invitations that could have succeeded.
 */
async function sendInvites({
  deps,
  invites,
  organizationId,
}: {
  readonly deps: FinishWorkspaceDeps;
  readonly invites: readonly string[];
  readonly organizationId: string;
}): Promise<{ failed: string[]; invited: string[] }> {
  const failed: string[] = [];
  const invited: string[] = [];

  for (const email of invites) {
    try {
      const { error } = await deps.invite({ email, organizationId });

      if (error !== null && error !== undefined) {
        failed.push(email);

        continue;
      }

      invited.push(email);
    } catch {
      // A throw here is one invitation, not the batch. Without this the actor
      // rejected, the machine moved to `done` through its error transition, and
      // every invitation made before this one was reported as none.
      failed.push(email);
    }
  }

  return { failed, invited };
}
