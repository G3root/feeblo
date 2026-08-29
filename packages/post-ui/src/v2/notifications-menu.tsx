import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import {
  parseRpcError,
  RpcError,
  type ParsedRpcError,
} from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const REFRESH_MS = 30_000;
const LIST_LIMIT = 20;

type NotificationRow = {
  id: string;
  organizationId: string;
  title: string;
  body: string | null;
  href: string;
  readAt: Date | string | null;
  createdAt: Date | string;
};

/**
 * The in-app notifications bell, shared by the dashboard and the public
 * board. Renders nothing for signed-out visitors. Data always comes from the
 * `*Public` notification endpoints, which are scoped to the session user id,
 * so the same component serves members and end-user subscribers alike.
 *
 * `onNavigate` lets the host app route notification clicks through its own
 * router; by default the browser navigates to the stored href. `onMarkReadError`
 * lets the host app surface mark-read failures with its own toast; it receives
 * the already-parsed RPC error.
 */
export function NotificationsMenu({
  organizationId,
  onMarkReadError,
  onNavigate,
}: {
  organizationId: string;
  onMarkReadError?: (error: ParsedRpcError) => void;
  onNavigate?: (href: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useAuthState();
  const [open, setOpen] = useState(false);

  const userId = session?.user.id;
  // Keyed per user so a sign-out/sign-in on the same workspace never reuses
  // the previous visitor's cached inbox.
  const listKey = ["notifications", organizationId, userId];

  const { data: unread } = useQuery({
    enabled: Boolean(session),
    queryFn: ({ signal }) =>
      fetchRpc(
        (rpc) => rpc.NotificationUnreadCountPublic({ organizationId }),
        { signal }
      ),
    queryKey: [...listKey, "unread"],
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  const { data: notifications } = useQuery({
    enabled: Boolean(session),
    queryFn: ({ signal }) =>
      fetchRpc(
        (rpc) =>
          rpc.NotificationListPublic({ organizationId, limit: LIST_LIMIT }),
        { signal }
      ),
    queryKey: listKey,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: listKey });

  // `fetchRpc` rejects with `RpcError`; parse it here so hosts receive the
  // UI-safe `ParsedRpcError` instead of a raw unknown failure.
  const onError =
    onMarkReadError === undefined
      ? undefined
      : (error: RpcError) => onMarkReadError(parseRpcError(error));

  const markRead = useMutation<unknown, RpcError, string>({
    mutationFn: (notificationId: string) =>
      fetchRpc((rpc) =>
        rpc.NotificationMarkReadPublic({
          organizationId,
          notificationId,
        })
      ),
    onError,
    onSettled: invalidate,
  });

  const markAllRead = useMutation<unknown, RpcError, void>({
    mutationFn: () =>
      fetchRpc((rpc) => rpc.NotificationMarkAllReadPublic({ organizationId })),
    onError,
    onSettled: invalidate,
  });

  if (!session) {
    return null;
  }

  const unreadCount = unread?.count ?? 0;
  const rows: readonly NotificationRow[] = notifications ?? [];

  const navigate = (href: string) => {
    if (onNavigate) {
      onNavigate(href);
      return;
    }
    window.location.assign(href);
  };

  return (
    <Menu onOpenChange={setOpen} open={open}>
      <MenuTrigger
        render={
          <Button aria-label="Notifications" className="relative" size="icon-sm" variant="ghost" />
        }
      >
        <HugeiconsIcon icon={BellDotIcon} />
        {unreadCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute top-0.5 right-0.5 flex min-w-4 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full px-1 text-[10px] leading-4">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </MenuTrigger>
      <MenuPopup align="end" className="w-96 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              onClick={() => markAllRead.mutate()}
              size="xs"
              variant="ghost"
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              You&rsquo;re all caught up.
            </p>
          ) : (
            rows.map((notification) => {
              const isUnread = !notification.readAt;
              return (
                <MenuItem
                  className={`hover:bg-accent/60 h-auto rounded-none border-b px-4 py-3 ${isUnread ? "bg-accent/30" : ""}`}
                  key={notification.id}
                  onClick={() => {
                    if (isUnread) {
                      markRead.mutate(notification.id);
                    }
                    navigate(notification.href);
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
              );
            })
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
}
