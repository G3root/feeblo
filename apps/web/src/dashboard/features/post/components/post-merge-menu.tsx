import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Button } from "@feeblo/ui/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@feeblo/ui/command";
import { Kbd, KbdGroup } from "@feeblo/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { GitMergeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, isNull, not, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Which side of the merge the viewed post takes. "into-this" keeps the
 * viewed post and absorbs the chosen duplicates; "into-existing" archives
 * the viewed post in favor of the chosen canonical post.
 */
type MergeDirection = "into-this" | "into-existing";

interface MergeCandidate {
  id: string;
  slug: string;
  title: string;
}

/**
 * Manager-only merge affordance for a dashboard post. The trigger is an
 * icon button menu with the two directions; picking one opens a command
 * palette to search the board's posts, and selecting a post runs
 * `PostMerge`.
 */
export function PostMergeMenu() {
  const { canModeratePost, isArchived, isMerged } = usePostCollectionData();
  const [direction, setDirection] = useState<MergeDirection | null>(null);

  // Merging a post that is already archived or merged is rejected by the
  // repository, so never offer the affordance for those rows.
  if (!(canModeratePost && !isArchived && !isMerged)) {
    return null;
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="Merge post"
              className="rounded-full"
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <HugeiconsIcon icon={GitMergeIcon} />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem closeOnClick onClick={() => setDirection("into-this")}>
            <HugeiconsIcon icon={GitMergeIcon} />
            Merge others to this
          </MenuItem>
          <MenuItem closeOnClick onClick={() => setDirection("into-existing")}>
            <HugeiconsIcon icon={GitMergeIcon} />
            Merge to existing
          </MenuItem>
        </MenuPopup>
      </Menu>
      {direction === null ? null : (
        <PostMergeCommandDialog
          direction={direction}
          onOpenChange={(open) => {
            if (!open) {
              setDirection(null);
            }
          }}
        />
      )}
    </>
  );
}

function PostMergeCommandDialog({
  direction,
  onOpenChange,
}: {
  readonly direction: MergeDirection;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { board, organizationId, post } = usePostCollectionData();
  const {
    commentCollection,
    postActivityCollection,
    postCollection,
    upvoteCollection,
  } = useDashboardCollections();
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);

  // Candidates are open posts on the same board: archived and already-merged
  // rows cannot participate in a merge (repository-enforced), and the viewed
  // post is never its own source or target.
  const { data: candidates } = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post: candidate }) =>
          and(
            eq(candidate.organizationId, organizationId),
            eq(candidate.boardId, board.id),
            isNull(candidate.archivedAt),
            isNull(candidate.mergedIntoPostId),
            not(eq(candidate.id, post.id))
          )
        )
        .orderBy(({ post: candidate }) => candidate.createdAt, "desc")
        .select(({ post: candidate }) => ({
          id: candidate.id,
          slug: candidate.slug,
          title: candidate.title,
        })),
    [board.id, organizationId, post.id, postCollection]
  );

  const items = useMemo(
    () =>
      (candidates ?? []).map((candidate) => ({
        candidate,
        label: candidate.title,
        value: candidate.id,
      })),
    [candidates]
  );

  const merge = async (candidate: MergeCandidate) => {
    if (isPending) {
      return;
    }

    setIsPending(true);

    const sourcePostId = direction === "into-this" ? candidate.id : post.id;
    const targetPostId = direction === "into-this" ? post.id : candidate.id;

    try {
      await fetchRpc((rpc) =>
        rpc.PostMerge({ organizationId, sourcePostId, targetPostId })
      );

      await Promise.all([
        commentCollection.utils.refetch(),
        postCollection.utils.refetch(),
        postActivityCollection.utils.refetch(),
        upvoteCollection.utils.refetch(),
      ]);

      trackEvent("post_merged", { direction, success: true });

      toastManager.add({
        title:
          direction === "into-this"
            ? `Merged "${candidate.title}" into this post`
            : `Merged this post into "${candidate.title}"`,
        type: "success",
      });

      onOpenChange(false);

      // The viewed post is archived by "into-existing"; send the author to
      // the surviving post instead of leaving them on a merged row.
      if (direction === "into-existing") {
        await navigate({
          params: {
            boardSlug: board.slug,
            organizationId,
            postSlug: candidate.slug,
          },
          to: "/$organizationId/post/$boardSlug/$postSlug",
        });
      }
    } catch {
      trackEvent("post_merged", { direction, success: false });

      toastManager.add({
        title: "Failed to merge post",
        type: "error",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <CommandDialog onOpenChange={onOpenChange} open>
      <CommandDialogPopup>
        <Command items={items}>
          <CommandInput placeholder="Search posts to merge..." />
          <CommandPanel>
            <CommandEmpty>No other posts on this board.</CommandEmpty>
            <CommandList>
              {(item: {
                candidate: MergeCandidate;
                label: string;
                value: string;
              }) => (
                <CommandItem
                  disabled={isPending}
                  key={item.value}
                  onClick={() => void merge(item.candidate)}
                  value={item.value}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd>
                    <ArrowUpIcon />
                  </Kbd>
                  <Kbd>
                    <ArrowDownIcon />
                  </Kbd>
                </KbdGroup>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>
                  <CornerDownLeftIcon />
                </Kbd>
                <span>Open</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
