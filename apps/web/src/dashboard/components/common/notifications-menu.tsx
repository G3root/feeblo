import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AllRpcs } from "@feeblo/domain/rpc-group";
import { createRpcProtocolLive } from "@feeblo/rpc-client";
import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { BellDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";
import { useContext, useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";

const refreshMs = 30_000;

const notificationReactivityKeys = (organizationId: string) => ({
  notifications: [organizationId],
});

class NotificationsClient extends AtomRpc.Service<NotificationsClient>()(
  "NotificationsClient",
  {
    group: AllRpcs,
    // The existing RPC route is HTTP-based. Keeping the protocol here gives
    // the atom client the same credentials and serialization as fetchRpc.
    protocol: () => createRpcProtocolLive(getRuntimePublicEnv().apiUrl),
  }
) {}

const notificationListAtom = Atom.family((organizationId: string) =>
  Atom.swr(
    Atom.withRefresh(
      NotificationsClient.query(
        "NotificationList",
        { organizationId, limit: 20 },
        {
          reactivityKeys: notificationReactivityKeys(organizationId),
          timeToLive: refreshMs,
        }
      ),
      refreshMs
    ),
    { staleTime: refreshMs }
  )
);

const notificationUnreadAtom = Atom.family((organizationId: string) =>
  Atom.swr(
    Atom.withRefresh(
      NotificationsClient.query(
        "NotificationUnreadCount",
        { organizationId },
        {
          reactivityKeys: notificationReactivityKeys(organizationId),
        }
      ),
      refreshMs
    ),
    { staleTime: refreshMs }
  )
);

const preloadNotificationsAtom = Atom.fnSync((organizationId: string, get) => {
  get(notificationListAtom(organizationId));
});

function NotificationsList({
  onNavigate,
  organizationId,
}: {
  readonly onNavigate: (href: string) => void;
  readonly organizationId: string;
}) {
  const list = useAtomValue(notificationListAtom(organizationId));
  const markRead = useAtomSet(
    NotificationsClient.mutation("NotificationMarkRead"),
    { mode: "promise" }
  );

  const notifications = Result.getOrElse(list, () => []);

  return (
    <>
      {Result.isSuccess(list) && notifications.length === 0 && (
        <p className="text-muted-foreground px-4 py-8 text-center text-sm">
          You’re all caught up.
        </p>
      )}
      {notifications.map((notification) => (
        <MenuItem
          className={`hover:bg-accent/60 h-auto rounded-none border-b px-4 py-3 ${notification.readAt ? "" : "bg-accent/30"}`}
          key={notification.id}
          onClick={() => {
            onNavigate(notification.href);

            if (!notification.readAt) {
              void markRead({
                payload: {
                  organizationId,
                  notificationId: notification.id,
                },
                reactivityKeys: notificationReactivityKeys(organizationId),
              });
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
    </>
  );
}

export function NotificationsMenu() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const registry = useContext(RegistryContext);
  const [open, setOpen] = useState(false);
  const unread = useAtomValue(notificationUnreadAtom(organizationId));
  const markAllRead = useAtomSet(
    NotificationsClient.mutation("NotificationMarkAllRead"),
    { mode: "promise" }
  );

  const unreadCount = Result.getOrElse(unread, () => ({ count: 0 })).count;

  return (
    <>
      <Menu onOpenChange={setOpen} open={open}>
        <MenuTrigger
          render={
            <Button
              aria-label="Notifications"
              className="relative"
              onFocus={() => {
                registry.set(preloadNotificationsAtom, organizationId);
              }}
              onMouseEnter={() => {
                registry.set(preloadNotificationsAtom, organizationId);
              }}
              size="icon-sm"
              variant="ghost"
            />
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
                onClick={async () => {
                  await markAllRead({
                    payload: { organizationId },
                    reactivityKeys: notificationReactivityKeys(organizationId),
                  });
                }}
                size="xs"
                variant="ghost"
              >
                Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {open && (
              <NotificationsList
                onNavigate={(href) => {
                  const url = new URL(href, window.location.origin);
                  void navigate({
                    to: url.pathname,
                    ...(url.hash && { hash: url.hash.slice(1) }),
                  });
                }}
                organizationId={organizationId}
              />
            )}
          </div>
        </MenuPopup>
      </Menu>
    </>
  );
}
