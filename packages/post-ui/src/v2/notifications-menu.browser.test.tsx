import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { m } from "../paraglide/messages.js";
import { NotificationsMenu } from "./notifications-menu";

// The menu reads its data through the shared runtime module and its session
// through the shared auth hook, and it has no injection point for either, so
// intercepting those two modules is the only faithful seam. `vi.hoisted` keeps
// the canned inbox reachable from the factories, which run before imports.
const mocks = vi.hoisted(() => {
  const rows = [
    {
      actorImage: null,
      actorName: "Ada Lovelace",
      body: "Dark mode please",
      createdAt: "2026-01-01T00:00:00.000Z",
      href: "/org_1/post/board/dark-mode",
      id: "notification_1",
      kind: "feedback.commented",
      organizationId: "org_1",
      readAt: null,
      title: "New comment on feedback",
    },
    {
      actorImage: null,
      actorName: null,
      body: "Dark mode please",
      createdAt: "2025-12-31T00:00:00.000Z",
      href: "/org_1/post/board/dark-mode",
      id: "notification_2",
      kind: "feedback.submitted",
      organizationId: "org_1",
      readAt: "2026-01-02T00:00:00.000Z",
      title: "New feedback submission",
    },
  ];

  const rpc = {
    NotificationListPublic: vi.fn(() => Promise.resolve(rows)),
    NotificationMarkAllReadPublic: vi.fn(() => Promise.resolve(undefined)),
    NotificationMarkReadPublic: vi.fn(() => Promise.resolve(undefined)),
    NotificationUnreadCountPublic: vi.fn(() => Promise.resolve({ count: 1 })),
  };

  return {
    rpc,
    fetchRpc: <A,>(callback: (client: typeof rpc) => A) =>
      Promise.resolve(callback(rpc)),
  };
});

// eslint-disable-next-line anti-slop/no-module-mocking -- the shared runtime module is the only data seam
vi.mock("@feeblo/web-shared/use-auth-state", () => ({
  useAuthState: () => ({ data: { user: { id: "user_1" } } }),
}));

// eslint-disable-next-line anti-slop/no-module-mocking -- the shared auth hook is the only session seam
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: mocks.fetchRpc,
}));

function renderNotificationsMenu() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsMenu onNavigate={() => undefined} organizationId="org_1" />
    </QueryClientProvider>
  );
}

describe("NotificationsMenu", () => {
  it("shows the actor's avatar and marks only unread rows", async () => {
    const screen = await renderNotificationsMenu();
    await screen.getByRole("button", { name: m.quaint_less_panther() }).click();

    const unread = screen.getByRole("menuitem", {
      name: /New comment on feedback/,
    });
    await expect.element(unread).toBeVisible();
    // Initials come from the actor the list RPC resolved. The inbox does not
    // draw the member tick; that stays on comments and post lists.
    await expect.element(unread.getByText("AL")).toBeVisible();
    expect(
      unread.element().querySelector('[data-slot="member-tick"]')
    ).toBeNull();
    await expect.element(unread.getByText(m.sunny_brave_gecko())).toBeVisible();
    // The double tick belongs to the header action, never to a row.
    expect(
      unread
        .element()
        .querySelector('[data-slot="notification-read-state"]')
        ?.querySelector("svg")
    ).toBeNull();

    const read = screen.getByRole("menuitem", {
      name: /New feedback submission/,
    });
    await expect.element(read).toBeVisible();
    // A read row carries no mark at all; the empty box only reserves the space.
    const readMark = read
      .element()
      .querySelector('[data-slot="notification-read-state"]');
    expect(readMark?.textContent).toBe("");
    expect(readMark?.querySelector("svg")).toBeNull();
    // A row with no actor shows its event kind's icon, not `??` initials.
    const fallbackAvatar = read.element().querySelector('[data-slot="avatar"]');
    expect(fallbackAvatar?.querySelector("svg")).not.toBeNull();
    expect(fallbackAvatar?.textContent).toBe("");
    expect(
      read.element().querySelector('[data-slot="member-tick"]')
    ).toBeNull();

    const markAll = screen.getByRole("button", {
      name: m.tasty_loose_lizard(),
    });
    await expect.element(markAll).toBeVisible();
    expect(markAll.element().querySelector("svg")).not.toBeNull();
  });

  it("marks a row read and the whole inbox read through the public RPCs", async () => {
    const screen = await renderNotificationsMenu();
    await screen.getByRole("button", { name: m.quaint_less_panther() }).click();

    await screen
      .getByRole("menuitem", { name: /New comment on feedback/ })
      .click();
    await vi.waitFor(() =>
      expect(mocks.rpc.NotificationMarkReadPublic).toHaveBeenCalledWith({
        notificationId: "notification_1",
        organizationId: "org_1",
      })
    );

    // The item click dismisses the menu, so reopen it for the header action.
    await screen.getByRole("button", { name: m.quaint_less_panther() }).click();
    await screen.getByRole("button", { name: m.tasty_loose_lizard() }).click();
    await vi.waitFor(() =>
      expect(mocks.rpc.NotificationMarkAllReadPublic).toHaveBeenCalledWith({
        organizationId: "org_1",
      })
    );
  });
});
