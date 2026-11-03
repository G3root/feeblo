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
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { Add01Icon, BanIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

const bansQueryKey = (organizationId: string, search: string) =>
  ["user-bans", organizationId, search] as const;

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
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [banOpen, setBanOpen] = React.useState(false);

  const queryKey = bansQueryKey(organizationId, search);
  const bansQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchRpc(
        (rpc) =>
          rpc.ListUserBans({
            limit: 100,
            offset: 0,
            organizationId,
            ...(search.trim() !== "" && { search: search.trim() }),
          }),
        { signal }
      ),
  });

  const unban = useMutation({
    mutationFn: (id: string) =>
      fetchRpc((rpc) =>
        rpc.UnbanUser({
          id: asLegid(UserBanId)(id),
          organizationId,
        })
      ),
    onError: (error) => {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["user-bans", organizationId],
      });
      toastManager.add({ title: "User unbanned", type: "success" });
    },
  });

  const bans = bansQuery.data?.items ?? [];
  const total = bansQuery.data?.total ?? 0;
  const hasFilter = search.trim() !== "";

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

        {bansQuery.isPending ? (
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
        ) : bansQuery.isError ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BanIcon} />
              </EmptyMedia>
              <EmptyTitle>Unable to load banned users</EmptyTitle>
              <EmptyDescription>
                {parseRpcError(bansQuery.error).message}
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
                    disabled={unban.isPending}
                    onClick={() => unban.mutate(ban.id)}
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
        onBanned={() => {
          void queryClient.invalidateQueries({
            queryKey: ["user-bans", organizationId],
          });
        }}
        onOpenChange={setBanOpen}
        open={banOpen}
        organizationId={organizationId}
      />
    </SettingsItem.Root>
  );
}

function BanUserDialog({
  onBanned,
  onOpenChange,
  open,
  organizationId,
}: {
  onBanned: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [deleteContent, setDeleteContent] = React.useState(false);

  const ban = useMutation({
    mutationFn: () =>
      fetchRpc((rpc) =>
        rpc.BanUser({
          organizationId,
          target: { _tag: "email", email: email.trim() },
          deleteContent,
          ...(reason.trim() !== "" && { reason: reason.trim() }),
        })
      ),
    onError: (error) => {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    },
    onSuccess: () => {
      onBanned();
      setEmail("");
      setReason("");
      setDeleteContent(false);
      onOpenChange(false);
      toastManager.add({ title: "User banned", type: "success" });
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
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
            ban.mutate();
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
            <Button
              disabled={ban.isPending || email.trim() === ""}
              type="submit"
            >
              {ban.isPending ? "Banning..." : "Ban user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
