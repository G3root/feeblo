import type { TNotificationEventType } from "@feeblo/domain/notification/schema";
import { Avatar } from "@feeblo/ui/avatar";
import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import {
  parseRpcError,
  RpcError,
  type ParsedRpcError,
} from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  BellDotIcon,
  CommentAdd01Icon,
  GitMergeIcon,
  Megaphone01Icon,
  Note01Icon,
  Progress01Icon,
  TickDouble02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { m } from "../paraglide/messages.js";

const REFRESH_MS = 30_000;
const LIST_LIMIT = 20;

type NotificationRow = {
  id: string;
  organizationId: string;
  kind: TNotificationEventType;
  title: string;
  body: string | null;
  href: string;
  actorName: string | null;
  actorImage: string | null;
  actorIsMember: boolean;
  readAt: Date | string | null;
  createdAt: Date | string;
};

/**
 * One icon per event type, drawn when a row has no actor to show a face for.
 *
 * `satisfies Record<NotificationEventType, …>` rather than a lookup with a
 * default on purpose: a new event type has to be given an icon here instead of
 * silently inheriting the bell.
 */
const NOTIFICATION_KIND_ICONS = {
  "changelog.published": Megaphone01Icon,
  "changelog.updated": Megaphone01Icon,
  "feedback.commented": CommentAdd01Icon,
  "feedback.merged": GitMergeIcon,
  "feedback.status_changed": Progress01Icon,
  "feedback.submitted": Note01Icon,
  "feedback.unmerged": Undo02Icon,
} satisfies Record<TNotificationEventType, IconSvgElement>;

/**
 * The actor's face, or the event kind's icon when there is no actor: a public
 * submission has none, and deleting an account nulls `actor_user_id` while the
 * row stays. A nameless `UserAvatar` would render `??`, so the fallback is an
 * icon on a muted circle of the same size, which keeps every row's text column
 * aligned. A member's face carries the blue member tick so a team reply reads
 * differently from a customer's or a public-board commenter's.
 */
function NotificationAvatar({
  actorImage,
  actorIsMember,
  actorName,
  kind,
}: {
  actorImage: string | null;
  actorIsMember: boolean;
  actorName: string | null;
  kind: TNotificationEventType;
}) {
  if (actorName === null) {
    return (
      <Avatar className="bg-muted" size="default">
        <HugeiconsIcon
          aria-hidden="true"
          className="text-muted-foreground size-4"
          icon={NOTIFICATION_KIND_ICONS[kind]}
        />
      </Avatar>
    );
  }

  return (
    <UserAvatar
      image={actorImage}
      isMember={actorIsMember}
      memberLabel={m.sad_soft_tadpole()}
      name={actorName}
      size="default"
    />
  );
}

/**
 * The row's read state: a brand dot on an unread row, nothing on a read one.
 * The box around the dot is always rendered and the dot is centred in it, so a
 * row keeps its title and body in the same column whether or not it carries a
 * mark. The dot is labelled for screen readers because it has no text.
 */
function NotificationReadState({ isUnread }: { isUnread: boolean }) {
  return (
    <span
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
      data-slot="notification-read-state"
    >
      {isUnread && (
        <>
          <span className="bg-brand size-2 rounded-full" />
          <span className="sr-only">{m.sunny_brave_gecko()}</span>
        </>
      )}
    </span>
  );
}

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
      fetchRpc((rpc) => rpc.NotificationUnreadCountPublic({ organizationId }), {
        signal,
      }),
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
          <Button
            aria-label={m.quaint_less_panther()}
            className="relative"
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
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold">
            {m.quaint_less_panther()}
          </span>
          {unreadCount > 0 && (
            <Button
              onClick={() => markAllRead.mutate()}
              size="xs"
              variant="brand"
            >
              <HugeiconsIcon aria-hidden="true" icon={TickDouble02Icon} />
              {m.tasty_loose_lizard()}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              {m.neat_brief_hamster()}
            </p>
          ) : (
            rows.map((notification) => {
              const isUnread = !notification.readAt;
              return (
                <MenuItem
                  className={cn(
                    "hover:bg-accent/60 h-auto items-start gap-3 rounded-none px-4 py-3",
                    isUnread && "bg-accent/30"
                  )}
                  data-slot="notification"
                  key={notification.id}
                  onClick={() => {
                    if (isUnread) {
                      markRead.mutate(notification.id);
                    }
                    navigate(notification.href);
                  }}
                >
                  <NotificationAvatar
                    actorImage={notification.actorImage}
                    actorIsMember={notification.actorIsMember}
                    actorName={notification.actorName}
                    kind={notification.kind}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{notification.title}</p>
                    {notification.body && (
                      <p className="text-muted-foreground mt-0.5 truncate text-sm">
                        {notification.body}
                      </p>
                    )}
                  </div>
                  <NotificationReadState isUnread={isUnread} />
                </MenuItem>
              );
            })
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
}
