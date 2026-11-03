import { useAtomSet, useAtomValue, useAtomRefresh } from "@effect/atom-react";
import { asLegid, UserBanId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Input } from "@feeblo/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@feeblo/ui/input-group";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@feeblo/ui/item";
import { Label } from "@feeblo/ui/label";
import { SkeletonLoader } from "@feeblo/ui/skeleton-loader";
import { Textarea } from "@feeblo/ui/textarea";
import { toastManager } from "@feeblo/ui/toast";
import { refetchInBackground } from "@feeblo/web-shared/collections";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { Add01Icon, BanIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as Result from "effect/reactivity/AsyncResult";
import * as React from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  banUserAtom,
  unbanUserAtom,
  type UserBan,
  userBanReactivityKeys,
  userBansAtom,
} from "../atoms";

/**
 * The workspace's banned end users.
 *
 * A ban stops the person writing on the portal or through the widget; it does
 * not hide their existing posts, stop their email, or lock their account. The
 * copy says that because an operator who expects a delete will otherwise
 * assume the ban did nothing — and the ban dialog offers that delete
 * explicitly instead of doing it silently.
 */
export function BannedUsersSection({
  userBansAvailable,
}: {
  /** The plan capability; the list stays readable when it lapses. */
  userBansAvailable: boolean;
}) {
  const organizationId = useOrganizationId();
  const { commentCollection, postCollection } = useDashboardCollections();
  const [search, setSearch] = React.useState("");
  const [banOpen, setBanOpen] = React.useState(false);
  const [unbanningId, setUnbanningId] = React.useState<string | null>(null);

  const trimmedSearch = search.trim();
  const listArgs = React.useMemo(
    () => ({ organizationId, search: trimmedSearch }),
    [organizationId, trimmedSearch]
  );
  const bansResult = useAtomValue(userBansAtom(listArgs));
  const refreshBans = useAtomRefresh(userBansAtom(listArgs));
  const unban = useAtomSet(unbanUserAtom, { mode: "promise" });

  const {
    items: bans,
    error,
    isLoading,
    loadFailed,
    total,
  } = Result.builder(bansResult)
    .onInitial(() => ({
      // SAFETY: Empty-state placeholder: an empty page is valid until the read resolves.
      items: [] as readonly UserBan[],
      error: undefined,
      isLoading: true,
      loadFailed: false,
      total: 0,
    }))
    .onFailure((failure, { previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => ({
          // SAFETY: Empty-state placeholder: an empty page is valid until the read resolves.
          items: [] as readonly UserBan[],
          error: failure,
          isLoading: false,
          loadFailed: true,
          total: 0,
        }),
        // A failed refetch keeps the rows on screen: the last good page is
        // still more useful than an error where the list used to be.
        onSome: ({ value }) => ({
          items: value.items,
          error: failure,
          isLoading: false,
          loadFailed: false,
          total: value.total,
        }),
      })
    )
    .onSuccess((value) => ({
      items: value.items,
      error: undefined,
      isLoading: false,
      loadFailed: false,
      total: value.total,
    }))
    .exhaustive();

  const hasFilter = trimmedSearch !== "";

  const handleUnban = async (id: string) => {
    setUnbanningId(id);
    try {
      await unban({
        payload: {
          _tag: "row",
          id: asLegid(UserBanId)(id),
          organizationId,
        },
        reactivityKeys: userBanReactivityKeys(organizationId),
      });
      // The settings list is cached in an atom and refreshes through the
      // reactivity key. The badges are collection rows, so they need saying
      // separately: without this, a post page opened afterwards still reports
      // the author as banned.
      refetchInBackground(
        postCollection.utils.refetch(),
        commentCollection.utils.refetch()
      );
      toastManager.add({ title: "User unbanned", type: "success" });
    } catch (failure) {
      toastManager.add({
        title: parseRpcError(failure).message,
        type: "error",
      });
    } finally {
      setUnbanningId(null);
    }
  };

  return (
    <SettingsItem.Root>
      <SettingsItem.Header>
        <SettingsItem.Title>
          Banned users
          {userBansAvailable ? null : (
            <SettingsItem.PaidPlanIndicator
              className="ml-2 inline-block"
              content="Banning users requires the Starter plan or higher."
            />
          )}
        </SettingsItem.Title>
        <SettingsItem.Description>
          Banned people can still read the board, but cannot post, comment,
          vote, react, or subscribe. Banning removes their votes and
          unsubscribes them from every post, changelog, and email subscription
          here. Their existing content stays visible unless you ask for it to be
          deleted when you ban them.
        </SettingsItem.Description>
      </SettingsItem.Header>

      <SettingsItem.Content>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <InputGroup>
              <InputGroupInput
                aria-label="Search banned users"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by email"
                type="search"
                value={search}
              />
              <InputGroupAddon>
                <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <PolicyGuard
            policy={hasPermission(organizationId, "userBans.manage")}
          >
            <Button
              disabled={!userBansAvailable}
              onClick={() => setBanOpen(true)}
              variant="outline"
            >
              <HugeiconsIcon icon={Add01Icon} />
              Add banned user
            </Button>
          </PolicyGuard>
        </div>

        {isLoading ? (
          <SkeletonLoader isLoading>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((key) => (
                <SettingsItem.Item key={key}>
                  <ItemContent>
                    <ItemTitle className="bg-muted h-4 w-40 rounded" />
                    <ItemDescription className="bg-muted h-3 w-64 rounded" />
                  </ItemContent>
                </SettingsItem.Item>
              ))}
            </div>
          </SkeletonLoader>
        ) : loadFailed ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BanIcon} />
              </EmptyMedia>
              <EmptyTitle>Unable to load banned users</EmptyTitle>
              <EmptyDescription>
                {parseRpcError(error).message}{" "}
                <Button onClick={refreshBans} size="sm" variant="outline">
                  Try again
                </Button>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : bans.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BanIcon} />
              </EmptyMedia>
              <EmptyTitle>
                {hasFilter
                  ? "No banned users match this search"
                  : "No banned users"}
              </EmptyTitle>
              <EmptyDescription>
                {hasFilter
                  ? "Try a different name or email address."
                  : "Ban a person by email address to stop them writing here. They can still read, and their existing content stays visible."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2" role="list">
            {bans.map((ban) => (
              <SettingsItem.Item key={ban.id} role="listitem">
                <ItemContent>
                  <ItemTitle>
                    {ban.userName ?? ban.email ?? "Banned user"}
                  </ItemTitle>
                  <ItemDescription>
                    {/* The address is only worth its own line when the name
                        above is not the address itself; otherwise the card
                        says the same thing twice. */}
                    {ban.userName !== null && ban.email !== null ? (
                      <span className="block">{ban.email}</span>
                    ) : null}
                    <span className="block">
                      {ban.reason
                        ? `Reason: ${ban.reason}`
                        : "No reason recorded"}
                      {" · "}
                      Banned {new Date(ban.createdAt).toLocaleDateString()}
                      {ban.createdByName ? ` by ${ban.createdByName}` : ""}
                    </span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    disabled={unbanningId !== null}
                    onClick={() => {
                      void handleUnban(ban.id);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Unban
                  </Button>
                </ItemActions>
              </SettingsItem.Item>
            ))}
          </div>
        )}

        {total > bans.length ? (
          <p className="text-muted-foreground text-sm">
            Showing {bans.length} of {total} banned users. Narrow the search to
            find the rest.
          </p>
        ) : null}
      </SettingsItem.Content>

      <BanUserDialog
        onOpenChange={setBanOpen}
        open={banOpen}
        organizationId={organizationId}
      />
    </SettingsItem.Root>
  );
}

function BanUserDialog({
  onOpenChange,
  open,
  organizationId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const ban = useAtomSet(banUserAtom, { mode: "promise" });
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [deleteContent, setDeleteContent] = React.useState(false);
  const [isBanning, setIsBanning] = React.useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    // Closing the dialog drops what was typed for the previous person: the
    // form is reopened for whoever the operator picks next, and a note written
    // about one address must not be attached to another. Opening only forwards
    // the request, so the form starts empty either way.
    if (!nextOpen) {
      setEmail("");
      setReason("");
      setDeleteContent(false);
    }
    onOpenChange(nextOpen);
  };

  const handleBan = async () => {
    setIsBanning(true);
    try {
      await ban({
        payload: {
          organizationId,
          target: { _tag: "email", email: email.trim() },
          deleteContent,
          ...(reason.trim() === "" ? undefined : { reason: reason.trim() }),
        },
        reactivityKeys: userBanReactivityKeys(organizationId),
      });
      setEmail("");
      setReason("");
      setDeleteContent(false);
      onOpenChange(false);
      toastManager.add({ title: "User banned", type: "success" });
    } catch (failure) {
      toastManager.add({
        title: parseRpcError(failure).message,
        type: "error",
      });
    } finally {
      setIsBanning(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>
            Enter the email address of the person you want to ban. They can
            still read the board; they just cannot write to it. Their votes are
            removed and they are unsubscribed from every post, changelog, and
            email subscription here. Workspace members cannot be banned — remove
            them from the workspace instead.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleBan();
          }}
        >
          <DialogPanel className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ban-email">Email address</Label>
              <Input
                autoComplete="email"
                id="ban-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@example.com"
                required
                type="email"
                value={email}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ban-reason">Reason (optional)</Label>
              <Textarea
                id="ban-reason"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Spam, abuse, or a note for your team"
                value={reason}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                checked={deleteContent}
                id="ban-delete-content"
                onCheckedChange={(checked) => setDeleteContent(checked)}
              />
              <Label
                className="text-sm font-normal"
                htmlFor="ban-delete-content"
              >
                Also delete their posts and comments in this workspace
              </Label>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button disabled={isBanning || email.trim() === ""} type="submit">
              {isBanning ? "Banning..." : "Ban user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
