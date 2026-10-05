import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Separator } from "@feeblo/ui/separator";
import { Spinner } from "@feeblo/ui/spinner";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { authClient } from "@feeblo/web-shared/auth-client";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AuthShell } from "~/features/auth/components/auth-shell";

/** The invitation as the dashboard needs to render it. */
type InvitationLookup =
  | { readonly kind: "unavailable" }
  | { readonly kind: "wrong-recipient" }
  | {
      readonly kind: "ready";
      readonly invitation: {
        readonly organizationId: string;
        readonly organizationName: string;
        readonly inviterEmail: string;
        readonly role: string;
      };
    };

const roleLabel = (role: string): string =>
  role.length === 0
    ? role
    : `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;

/**
 * Accepting an invitation is an authenticated action, so this card is only
 * ever reached by a signed-in visitor: the dashboard guard sends anonymous
 * visitors to sign-in with `/invitation/<id>` as the return path, and the
 * invitation id survives sign-up, verification, and workspace creation.
 */
export function InvitationAcceptanceCard({
  invitationId,
}: {
  readonly invitationId: string;
}) {
  const navigate = useNavigate();
  const [responding, setResponding] = useState<"accept" | "reject" | null>(
    null
  );
  const invitationQuery = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: async (): Promise<InvitationLookup> => {
      const result = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (result.error) {
        // Better Auth answers "wrong account" with FORBIDDEN and every other
        // rejection — expired, revoked, already answered — with BAD_REQUEST.
        const wrongRecipient =
          result.error.status === 403 ||
          result.error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION";
        return wrongRecipient
          ? { kind: "wrong-recipient" }
          : { kind: "unavailable" };
      }
      return {
        kind: "ready",
        invitation: {
          organizationId: result.data.organizationId,
          organizationName: result.data.organizationName,
          inviterEmail: result.data.inviterEmail,
          role: result.data.role,
        },
      };
    },
    retry: false,
  });

  const lookup = invitationQuery.data;
  const organizationId =
    lookup?.kind === "ready" ? lookup.invitation.organizationId : undefined;

  const signInAsRecipient = async () => {
    await authClient.signOut();
    // A full navigation re-resolves the session before the guard runs; the
    // SPA's cached atom would otherwise still hold the signed-in account.
    window.location.assign(
      `/sign-in?redirectTo=${encodeURIComponent(`/invitation/${invitationId}`)}`
    );
  };

  const respond = async (action: "accept" | "reject") => {
    if (organizationId === undefined) {
      return;
    }
    setResponding(action);
    try {
      const result =
        action === "accept"
          ? await authClient.organization.acceptInvitation({ invitationId })
          : await authClient.organization.rejectInvitation({ invitationId });
      if (result.error) {
        trackEvent(
          action === "accept"
            ? "org_invitation_accepted"
            : "org_invitation_declined",
          { success: false }
        );
        toastManager.add({
          title:
            action === "accept"
              ? "Could not accept the invitation"
              : "Could not decline the invitation",
          type: "error",
        });
        return;
      }
      trackEvent(
        action === "accept"
          ? "org_invitation_accepted"
          : "org_invitation_declined",
        { success: true }
      );
      if (action === "reject") {
        toastManager.add({ title: "Invitation declined", type: "success" });
        // The guard resolves "/" to the user's own workspace, or to
        // registration when they have none yet.
        await navigate({ to: "/" });
        return;
      }
      // Accepting adds a membership; the cached session must see it before the
      // guard canonicalizes the destination. A failed refresh still leaves the
      // membership stored, so the destination workspace stays reachable.
      await refreshAuthSession().catch(() => null);
      toastManager.add({ title: "Invitation accepted", type: "success" });
      await navigate({
        to: "/$organizationId",
        params: { organizationId },
      });
    } finally {
      setResponding(null);
    }
  };

  if (invitationQuery.isPending) {
    return (
      <AuthShell
        description="Checking this invitation."
        footer={null}
        title="Workspace invitation"
      >
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner className="size-4" />
          Loading invitation…
        </div>
      </AuthShell>
    );
  }

  if (invitationQuery.isError) {
    return (
      <AuthShell
        description="Something went wrong while loading this invitation."
        footer={null}
        title="Workspace invitation"
      >
        <Alert variant="error">
          <AlertDescription>
            Try reloading the page, or ask the person who invited you to send a
            new invitation.
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => void invitationQuery.refetch()}
          variant="outline"
        >
          Try again
        </Button>
      </AuthShell>
    );
  }

  if (lookup?.kind === "wrong-recipient") {
    return (
      <AuthShell
        description="This invitation belongs to a different email address."
        footer={null}
        title="Wrong account"
      >
        <Alert variant="warning">
          <AlertTitle>Use the invited address</AlertTitle>
          <AlertDescription>
            Sign in with the email address this invitation was sent to, then
            open the link again.
          </AlertDescription>
        </Alert>
        <Button onClick={signInAsRecipient} variant="outline">
          Sign out and use another account
        </Button>
      </AuthShell>
    );
  }

  if (lookup?.kind !== "ready") {
    return (
      <AuthShell
        description="This invitation can no longer be used."
        footer={null}
        title="Invitation unavailable"
      >
        <Alert variant="error">
          <AlertDescription>
            It may have expired, been withdrawn, or already been answered. Ask
            the person who invited you to send a new one.
          </AlertDescription>
        </Alert>
        <Button onClick={() => void navigate({ to: "/" })} variant="outline">
          Go to your workspace
        </Button>
      </AuthShell>
    );
  }

  const { invitation } = lookup;

  return (
    <AuthShell
      description={`${invitation.inviterEmail} invited you to this workspace.`}
      footer={null}
      title={`Join ${invitation.organizationName}`}
    >
      <div className="text-sm">
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Workspace</span>
          <span className="font-medium">{invitation.organizationName}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Your role</span>
          <span className="font-medium">{roleLabel(invitation.role)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          disabled={responding !== null}
          loading={responding === "accept"}
          onClick={() => void respond("accept")}
          variant="brand"
        >
          Accept invitation
        </Button>
        <Button
          disabled={responding !== null}
          loading={responding === "reject"}
          onClick={() => void respond("reject")}
          variant="ghost"
        >
          Decline
        </Button>
      </div>
    </AuthShell>
  );
}
