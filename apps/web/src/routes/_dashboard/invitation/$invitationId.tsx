import { createFileRoute } from "@tanstack/react-router";

import { InvitationAcceptanceCard } from "~/features/invitation/components/invitation-acceptance-card";

/**
 * The link in a workspace invitation email.
 *
 * It lives outside `$organizationId` because the visitor is not a member of
 * the workspace yet — and may belong to no workspace at all. The dashboard
 * guard treats `/invitation/...` like the auth routes: anonymous visitors are
 * sent to sign-in with this path as their return link, and a signed-in visitor
 * without an organization is not pushed into `/register`, because accepting is
 * exactly how they get their first one.
 */
export const Route = createFileRoute("/_dashboard/invitation/$invitationId")({
  head: () => ({ meta: [{ title: "Workspace invitation" }] }),
  component: InvitationRoute,
});

function InvitationRoute() {
  const { invitationId } = Route.useParams();

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <InvitationAcceptanceCard invitationId={invitationId} />
      </div>
    </div>
  );
}
