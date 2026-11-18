import {
  authClient,
  organizationLogoUploadEndpoint,
} from "@feeblo/web-shared/auth-client";

import type {
  FinishWorkspacePayload,
  FinishWorkspaceResult,
} from "./register-wizard-machine";

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
export async function finishWorkspace({
  invites,
  logo,
  organizationId,
}: FinishWorkspacePayload): Promise<FinishWorkspaceResult> {
  // Independent of each other, so they go together: the reader is waiting on
  // both, and one has no bearing on the other's request.
  const [invitations, logoUploaded] = await Promise.all([
    sendInvites({ invites, organizationId }),
    uploadLogo({ logo, organizationId }),
  ]);

  return {
    failedInvites: invitations.failed,
    invited: invitations.invited,
    logoUploaded,
  };
}

async function uploadLogo({
  logo,
  organizationId,
}: {
  readonly logo: File | null;
  readonly organizationId: string;
}): Promise<boolean> {
  if (logo === null) {
    return false;
  }

  const body = new FormData();
  body.set("file", logo);
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
}

/**
 * Sends one invitation per address, sequentially.
 *
 * One call at a time because each invitation takes a seat, and the member
 * limit is checked per call: a burst would race itself and report the cap as a
 * failure on invitations that could have succeeded.
 */
async function sendInvites({
  invites,
  organizationId,
}: {
  readonly invites: readonly string[];
  readonly organizationId: string;
}): Promise<{ failed: string[]; invited: string[] }> {
  const failed: string[] = [];
  const invited: string[] = [];

  for (const email of invites) {
    try {
      const result = await authClient.organization.inviteMember({
        email,
        organizationId,
        // The least privilege an invitation can carry. Onboarding is the wrong
        // moment to hand someone management rights, and the owner can raise the
        // role from settings once they know what the person should do.
        role: "contributor",
      });

      if (result.error) {
        failed.push(email);

        continue;
      }

      invited.push(email);
    } catch {
      // A throw here is one invitation, not the batch. Without this the actor
      // rejected, the machine moved to `done` through its error transition,
      // and every invitation made before this one was reported as none.
      failed.push(email);
    }
  }

  return { failed, invited };
}
