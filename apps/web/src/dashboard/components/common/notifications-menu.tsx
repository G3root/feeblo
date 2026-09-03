import { NotificationsMenu as SharedNotificationsMenu } from "@feeblo/post-ui/notifications-menu";
import { useNavigate } from "@tanstack/react-router";

import { useOrganizationId } from "~/hooks/use-organization-id";

export function NotificationsMenu() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();

  return (
    <SharedNotificationsMenu
      onNavigate={(href) => {
        const url = new URL(href, window.location.origin);
        void navigate({
          to: url.pathname,
          ...(url.hash && { hash: url.hash.slice(1) }),
        });
      }}
      organizationId={organizationId}
    />
  );
}
