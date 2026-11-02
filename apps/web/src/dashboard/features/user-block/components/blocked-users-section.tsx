import { asLegid, UserBlockId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
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
import { BanIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

const blocksQueryKey = (organizationId: string, search: string) =>
  ["user-blocks", organizationId, search] as const;

/**
 * The workspace's blocked end users.
 *
 * A block stops the person writing on the portal or through the widget; it does
 * not hide their existing posts, stop their email, or ban their account. The
 * copy says that because an operator who expects a delete will otherwise
 * assume the block did nothing.
 */
export function BlockedUsersSection() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [blockOpen, setBlockOpen] = React.useState(false);

  const queryKey = blocksQueryKey(organizationId, search);
  const blocksQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchRpc(
        (rpc) =>
          rpc.ListUserBlocks({
            limit: 100,
            offset: 0,
            organizationId,
            ...(search.trim() !== "" && { search: search.trim() }),
          }),
        { signal }
      ),
  });

  const unblock = useMutation({
    mutationFn: (id: string) =>
      fetchRpc((rpc) =>
        rpc.UnblockUser({
          id: asLegid(UserBlockId)(id),
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
        queryKey: ["user-blocks", organizationId],
      });
      toastManager.add({ title: "User unblocked", type: "success" });
    },
  });

  const blocks = blocksQuery.data?.items ?? [];
  const total = blocksQuery.data?.total ?? 0;
  const hasFilter = search.trim() !== "";

  return (
    <SettingsItem.Root>
      <SettingsItem.Header>
        <SettingsItem.Title>Blocked users</SettingsItem.Title>
        <SettingsItem.Description>
          Blocked people can still read the board, but cannot post, comment,
          vote, react, or subscribe. Their existing content stays visible, and
          their email preferences are unchanged.
        </SettingsItem.Description>
      </SettingsItem.Header>

      <SettingsItem.Content>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <HugeiconsIcon
              className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
              icon={Search01Icon}
            />
            <Input
              aria-label="Search blocked users"
              className="ps-8"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              type="search"
              value={search}
            />
          </div>
          <PolicyGuard
            policy={hasPermission(organizationId, "userBlocks.manage")}
          >
            <Button onClick={() => setBlockOpen(true)} variant="outline">
              <HugeiconsIcon icon={BanIcon} />
              Block user
            </Button>
          </PolicyGuard>
        </div>

        {blocksQuery.isPending ? (
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
        ) : blocksQuery.isError ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BanIcon} />
              </EmptyMedia>
              <EmptyTitle>Unable to load blocked users</EmptyTitle>
              <EmptyDescription>
                {parseRpcError(blocksQuery.error).message}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : blocks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BanIcon} />
              </EmptyMedia>
              <EmptyTitle>
                {hasFilter
                  ? "No blocked users match this search"
                  : "No blocked users"}
              </EmptyTitle>
              <EmptyDescription>
                {hasFilter
                  ? "Try a different name or email address."
                  : "Block a person from a request, a customer profile, or by email to stop them writing here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2" role="list">
            {blocks.map((block) => (
              <SettingsItem.Item key={block.id} role="listitem">
                <ItemContent>
                  <ItemTitle>
                    {block.userName ?? block.email ?? "Blocked user"}
                  </ItemTitle>
                  <ItemDescription>
                    <span className="block">
                      {block.email ?? "No email on file"}
                    </span>
                    <span className="block">
                      {block.reason
                        ? `Reason: ${block.reason}`
                        : "No reason recorded"}
                      {" · "}
                      Blocked {new Date(block.createdAt).toLocaleDateString()}
                      {block.createdByName ? ` by ${block.createdByName}` : ""}
                    </span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    disabled={unblock.isPending}
                    onClick={() => unblock.mutate(block.id)}
                    size="sm"
                    variant="outline"
                  >
                    Unblock
                  </Button>
                </ItemActions>
              </SettingsItem.Item>
            ))}
          </div>
        )}

        {total > blocks.length ? (
          <p className="text-muted-foreground text-sm">
            Showing {blocks.length} of {total} blocked users. Narrow the search
            to find the rest.
          </p>
        ) : null}
      </SettingsItem.Content>

      <BlockUserDialog
        onBlocked={() => {
          void queryClient.invalidateQueries({
            queryKey: ["user-blocks", organizationId],
          });
        }}
        onOpenChange={setBlockOpen}
        open={blockOpen}
        organizationId={organizationId}
      />
    </SettingsItem.Root>
  );
}

function BlockUserDialog({
  onBlocked,
  onOpenChange,
  open,
  organizationId,
}: {
  onBlocked: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
}) {
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("");

  const block = useMutation({
    mutationFn: () =>
      fetchRpc((rpc) =>
        rpc.BlockUser({
          organizationId,
          target: { _tag: "email", email: email.trim() },
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
      onBlocked();
      setEmail("");
      setReason("");
      onOpenChange(false);
      toastManager.add({ title: "User blocked", type: "success" });
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Block user</DialogTitle>
          <DialogDescription>
            Enter the email address of the person you want to block. They can
            still read the board; they just cannot write to it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            block.mutate();
          }}
        >
          <DialogPanel className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="block-email">Email address</Label>
              <Input
                autoComplete="email"
                id="block-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@example.com"
                required
                type="email"
                value={email}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="block-reason">Reason (optional)</Label>
              <Textarea
                id="block-reason"
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Spam, abuse, or a note for your team"
                value={reason}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={block.isPending || email.trim() === ""}
              type="submit"
            >
              {block.isPending ? "Blocking..." : "Block user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
