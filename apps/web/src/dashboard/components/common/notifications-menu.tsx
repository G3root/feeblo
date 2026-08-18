import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

const refreshMs = 30_000;

export function NotificationsMenu() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: ["notifications", organizationId, "unread"],
    queryFn: () =>
      fetchRpc((rpc) => rpc.NotificationUnreadCount({ organizationId })),
    refetchInterval: refreshMs,
  });
  const list = useQuery({
    queryKey: ["notifications", organizationId, "list"],
    queryFn: () =>
      fetchRpc((rpc) => rpc.NotificationList({ organizationId, limit: 20 })),
    enabled: open,
    refetchInterval: open ? refreshMs : false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["notifications", organizationId],
    });

  return (
    <Menu onOpenChange={setOpen} open={open}>
      <MenuTrigger
        render={
          <Button
            aria-label="Notifications"
            className="relative"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon icon={BellDotIcon} />
        {(unread.data?.count ?? 0) > 0 && (
          <span className="bg-primary text-primary-foreground absolute top-0.5 right-0.5 flex min-w-4 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full px-1 text-[10px] leading-4">
            {(unread.data?.count ?? 0) > 99 ? "99+" : unread.data?.count}
          </span>
        )}
      </MenuTrigger>
      <MenuPopup align="end" className="w-96 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {(unread.data?.count ?? 0) > 0 && (
            <Button
              onClick={async () => {
                await fetchRpc((rpc) =>
                  rpc.NotificationMarkAllRead({ organizationId })
                );
                await refresh();
              }}
              size="xs"
              variant="ghost"
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.data?.length === 0 && (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              You’re all caught up.
            </p>
          )}
          {list.data?.map((notification) => (
            <MenuItem
              className={`hover:bg-accent/60 h-auto rounded-none border-b px-4 py-3 ${notification.readAt ? "" : "bg-accent/30"}`}
              key={notification.id}
              onClick={() => {
                const url = new URL(notification.href, window.location.origin);
                void navigate({
                  to: url.pathname,
                  ...(url.hash ? { hash: url.hash.slice(1) } : {}),
                });

                if (!notification.readAt) {
                  void fetchRpc((rpc) =>
                    rpc.NotificationMarkRead({
                      organizationId,
                      notificationId: notification.id,
                    })
                  ).then(refresh);
                }
              }}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{notification.title}</p>
                {notification.body && (
                  <p className="text-muted-foreground mt-0.5 truncate text-sm">
                    {notification.body}
                  </p>
                )}
              </div>
            </MenuItem>
          ))}
        </div>
      </MenuPopup>
    </Menu>
  );
}
