import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * Every cached ban page of one workspace refetches when a ban is created or
 * removed. The key is the workspace alone, not the search, so a write lands on
 * every search variant instead of only the one that happened to be on screen.
 */
export const userBanReactivityKeys = (organizationId: string) => ({
  userBans: [organizationId],
});

/**
 * Ban rows the page shows at a time. The list is an operator view with a search
 * box, not an export — `banned-users-section` names the remainder in a footer
 * line instead of paging — so one page is all it asks for.
 */
const USER_BAN_PAGE_SIZE = 100;

export type UserBanListArgs = {
  readonly organizationId: string;
  /** Operator search, already trimmed; an empty string means "the whole list". */
  readonly search: string;
};

const listRequest = (args: UserBanListArgs) => {
  const request = {
    limit: USER_BAN_PAGE_SIZE,
    offset: 0,
    organizationId: args.organizationId,
  };
  return args.search === "" ? request : { ...request, search: args.search };
};

/**
 * The workspace's ban list, cached per (workspace, search) pair.
 *
 * The pair is the cache key because the server filters before it paginates:
 * two searches are two different result sets, not two views of one.
 *
 * Effect Atom, not a TanStack DB collection. Neither write is optimistic: a ban
 * strips the person's votes and subscriptions and may delete their content in
 * the same transaction, so the row must not appear — or disappear — before the
 * server agrees. The ban *badges* elsewhere in the dashboard read
 * `Post`/`Comment.authorIsBanned`, which the server derives, so nothing has to
 * join against this list in the client either.
 */
export const userBansAtom = Atom.family((args: UserBanListArgs) =>
  DashboardClient.query("ListUserBans", listRequest(args), {
    reactivityKeys: userBanReactivityKeys(args.organizationId),
  }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type UserBan = Atom.Success<
  ReturnType<typeof userBansAtom>
>["items"][number];

export const banUserAtom = DashboardClient.mutation("BanUser");
export const unbanUserAtom = DashboardClient.mutation("UnbanUser");
