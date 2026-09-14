import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Badge } from "@feeblo/ui/badge";
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
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import { GitMergeIcon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, isNull, not, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  postMergeAtom,
  postSuggestionsAtom,
  postUnmergeAtom,
  type PostSuggestion,
} from "../atoms";

/**
 * Which side of the merge the viewed post takes. "into-this" keeps the
 * viewed post and absorbs the chosen duplicates; "into-existing" archives
 * the viewed post in favor of the chosen canonical post.
 */
type MergeDirection = "into-this" | "into-existing";

/** Open dialog: a merge direction, the unmerge picker, or nothing. */
type MergeDialogKind = MergeDirection | "unmerge" | null;

interface MergeCandidate {
  boardName: string;
  boardSlug: string;
  id: string;
  slug: string;
  statusType: string;
  title: string;
}

/** Stable empty identity so loading/failure states do not churn memo deps. */
const EMPTY_SUGGESTED_POST_IDS: ReadonlySet<string> = new Set();

const extractSuggestedPostIds = (suggestions: readonly PostSuggestion[]) =>
  new Set(suggestions.map((suggestion) => suggestion.id));

/**
 * Re-fetches every collection a merge or unmerge can touch. The mutation
 * moves comments, comment reactions, votes, post reactions, tags, and
 * subscriptions between posts, so refreshing only a subset leaves stale
 * counts and chips on the survivor.
 */
function useRefetchMergeData() {
  const {
    commentCollection,
    commentReactionCollection,
    postActivityCollection,
    postCollection,
    postReactionCollection,
    postSubscriptionCollection,
    postTagCollection,
    upvoteCollection,
  } = useDashboardCollections();

  return async () => {
    await Promise.all([
      commentCollection.utils.refetch(),
      commentReactionCollection.utils.refetch(),
      postActivityCollection.utils.refetch(),
      postCollection.utils.refetch(),
      postReactionCollection.utils.refetch(),
      postSubscriptionCollection.utils.refetch(),
      postTagCollection.utils.refetch(),
      upvoteCollection.utils.refetch(),
    ]);
  };
}

/**
 * Manager-only merge and unmerge affordance for a dashboard post.
 *
 * Open posts get the two merge directions plus "Unmerge a post" when the
 * viewed post already has merged-in duplicates. A merged post gets a single
 * "Unmerge this post" action, so the tombstone is always reversible.
 */
export function PostMergeMenu() {
  const { canModeratePost, isArchived, isMerged, organizationId, post } =
    usePostCollectionData();
  const { postCollection } = useDashboardCollections();
  const refetchMergeData = useRefetchMergeData();
  const unmergePost = useAtomSet(postUnmergeAtom, { mode: "promise" });
  const [dialog, setDialog] = useState<MergeDialogKind>(null);
  const [isUnmergingThis, setIsUnmergingThis] = useState(false);

  // Used to decide whether the "Unmerge a post" picker has anything to show.
  const { data: mergedInPosts } = useLiveQuery(
    (query) =>
      query
        .from({ candidate: postCollection })
        .where(({ candidate }) =>
          and(
            eq(candidate.organizationId, organizationId),
            eq(candidate.mergedIntoPostId, post.id)
          )
        )
        .select(({ candidate }) => ({ id: candidate.id })),
    [organizationId, post.id, postCollection]
  );

  const unmergeThisPost = async () => {
    if (isUnmergingThis) {
      return;
    }

    setIsUnmergingThis(true);
    try {
      await unmergePost({
        payload: { organizationId, sourcePostId: post.id },
        reactivityKeys: { postSuggestions: [post.id] },
      });
      await refetchMergeData();
      trackEvent("post_unmerged", { success: true });
      toastManager.add({
        title: "Post unmerged",
        description: "The post is back on its board.",
        type: "success",
      });
    } catch {
      trackEvent("post_unmerged", { success: false });
      toastManager.add({ title: "Failed to unmerge post", type: "error" });
    } finally {
      setIsUnmergingThis(false);
    }
  };

  // Merging a post that is already archived is rejected by the repository;
  // merged posts stay manageable so the action can be undone.
  if (!(canModeratePost && (!isArchived || isMerged))) {
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
          {isMerged ? (
            <MenuItem
              closeOnClick
              disabled={isUnmergingThis}
              onClick={() => void unmergeThisPost()}
            >
              <HugeiconsIcon icon={Undo02Icon} />
              Unmerge this post
            </MenuItem>
          ) : (
            <>
              <MenuItem closeOnClick onClick={() => setDialog("into-this")}>
                <HugeiconsIcon icon={GitMergeIcon} />
                Merge others to this
              </MenuItem>
              <MenuItem closeOnClick onClick={() => setDialog("into-existing")}>
                <HugeiconsIcon icon={GitMergeIcon} />
                Merge to existing
              </MenuItem>
              {(mergedInPosts ?? []).length > 0 ? (
                <MenuItem closeOnClick onClick={() => setDialog("unmerge")}>
                  <HugeiconsIcon icon={Undo02Icon} />
                  Unmerge a post
                </MenuItem>
              ) : null}
            </>
          )}
        </MenuPopup>
      </Menu>
      {dialog === null ? null : dialog === "unmerge" ? (
        <PostUnmergeCommandDialog
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
            }
          }}
        />
      ) : (
        <PostMergeCommandDialog
          direction={dialog}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
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
  const { organizationId, post } = usePostCollectionData();
  const { boardCollection, postCollection, postStatusCollection } =
    useDashboardCollections();
  const refetchMergeData = useRefetchMergeData();
  const mergePosts = useAtomSet(postMergeAtom, { mode: "promise" });
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<MergeCandidate | null>(
    null
  );

  // Embedding-based duplicate detection over the workspace: the same
  // `PostSuggestions` flow the create form uses, so likely duplicates are
  // flagged and sorted to the top of the picker instead of relying on the
  // moderator to scan every title. Subscribing mounts the query atom, so the
  // lookup fires when the picker opens and the atom runtime owns abort,
  // dedup, and caching — no effect needed. A failed lookup just leaves the
  // picker unfiltered.
  const suggestionsResult = useAtomValue(
    postSuggestionsAtom({
      excerpt: post.excerpt,
      organizationId,
      postId: post.id,
      title: post.title,
    })
  );
  const suggestedPostIds = useMemo(
    () =>
      Result.builder(suggestionsResult)
        .onInitial(() => EMPTY_SUGGESTED_POST_IDS)
        .onFailure(() => EMPTY_SUGGESTED_POST_IDS)
        .onSuccess(extractSuggestedPostIds)
        .exhaustive(),
    [suggestionsResult]
  );

  // Candidates are open posts anywhere in the workspace: archived and
  // already-merged rows cannot participate in a merge (repository-enforced),
  // and the viewed post is never its own source or target. The board join
  // labels each candidate so cross-board merges stay unambiguous.
  const { data: candidates } = useLiveQuery(
    (query) =>
      query
        .from({ post: postCollection })
        .join(
          { board: boardCollection },
          ({ board: candidateBoard, post: candidate }) =>
            eq(candidate.boardId, candidateBoard.id),
          "inner"
        )
        .join(
          { status: postStatusCollection },
          ({ post: candidate, status: candidateStatus }) =>
            eq(candidate.statusId, candidateStatus.id),
          "inner"
        )
        .where(({ post: candidate }) =>
          and(
            eq(candidate.organizationId, organizationId),
            isNull(candidate.archivedAt),
            isNull(candidate.mergedIntoPostId),
            not(eq(candidate.id, post.id))
          )
        )
        .orderBy(({ post: candidate }) => candidate.createdAt, "desc")
        .select(({ board: candidateBoard, post: candidate, status }) => ({
          boardName: candidateBoard.name,
          boardSlug: candidateBoard.slug,
          id: candidate.id,
          slug: candidate.slug,
          statusType: status.type,
          title: candidate.title,
        })),
    [
      boardCollection,
      organizationId,
      post.id,
      postCollection,
      postStatusCollection,
    ]
  );

  const items = useMemo(() => {
    const merged = (candidates ?? []).map((candidate) => ({
      candidate,
      isSuggested: suggestedPostIds.has(candidate.id),
      label: candidate.title,
      value: candidate.id,
    }));
    // Stable sort keeps the newest-first order inside each group.
    return [...merged].sort(
      (left, right) => Number(right.isSuggested) - Number(left.isSuggested)
    );
  }, [candidates, suggestedPostIds]);

  const merge = async (candidate: MergeCandidate) => {
    if (isPending) {
      return;
    }

    setIsPending(true);

    const sourcePostId = direction === "into-this" ? candidate.id : post.id;
    const targetPostId = direction === "into-this" ? post.id : candidate.id;

    try {
      await mergePosts({
        payload: { organizationId, sourcePostId, targetPostId },
        reactivityKeys: { postSuggestions: [post.id, candidate.id] },
      });

      await refetchMergeData();
      trackEvent("post_merged", { direction, success: true });

      toastManager.add({
        title:
          direction === "into-this"
            ? `Merged "${candidate.title}" into this post`
            : `Merged this post into "${candidate.title}"`,
        type: "success",
      });

      setConfirmTarget(null);
      onOpenChange(false);

      // The viewed post is archived by "into-existing"; send the moderator to
      // the surviving post instead of leaving them on a merged row.
      if (direction === "into-existing") {
        await navigate({
          params: {
            boardSlug: candidate.boardSlug,
            organizationId,
            postSlug: candidate.slug,
          },
          to: "/$organizationId/post/$boardSlug/$postSlug",
        });
      }
    } catch {
      trackEvent("post_merged", { direction, success: false });
      toastManager.add({ title: "Failed to merge post", type: "error" });
    } finally {
      setIsPending(false);
    }
  };

  if (confirmTarget) {
    const confirmTitle =
      direction === "into-this"
        ? `Merge "${confirmTarget.title}" into this post?`
        : `Merge this post into "${confirmTarget.title}"?`;
    return (
      <AlertDialog open>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              Comments, votes, reactions, tags, followers, and any changelog
              entry move to the surviving post. The merged post is archived and
              can be unmerged afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isPending}
              onClick={() => setConfirmTarget(null)}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              disabled={isPending}
              onClick={() => void merge(confirmTarget)}
            >
              {isPending ? "Merging..." : "Merge posts"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    );
  }

  return (
    <CommandDialog onOpenChange={onOpenChange} open>
      <CommandDialogPopup>
        <Command items={items}>
          <CommandInput placeholder="Search posts to merge..." />
          <CommandPanel>
            <CommandEmpty>No matching posts.</CommandEmpty>
            <CommandList>
              {(item: {
                candidate: MergeCandidate;
                isSuggested: boolean;
                label: string;
                value: string;
              }) => (
                <CommandItem
                  disabled={isPending}
                  key={item.value}
                  onClick={() => setConfirmTarget(item.candidate)}
                  value={item.value}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.isSuggested ? (
                    <Badge className="ml-2 shrink-0" size="sm" variant="info">
                      Possible duplicate
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {formatPostStatus(item.candidate.statusType)}
                  </span>
                  <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {item.candidate.boardName}
                  </span>
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
                <span>Merge</span>
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

function PostUnmergeCommandDialog({
  onOpenChange,
}: {
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { organizationId, post } = usePostCollectionData();
  const { boardCollection, postCollection, postStatusCollection } =
    useDashboardCollections();
  const refetchMergeData = useRefetchMergeData();
  const unmergePost = useAtomSet(postUnmergeAtom, { mode: "promise" });
  const [isPending, setIsPending] = useState(false);

  // Every post previously merged into the viewed post, newest first.
  const { data: mergedPosts } = useLiveQuery(
    (query) =>
      query
        .from({ post: postCollection })
        .join(
          { board: boardCollection },
          ({ board: candidateBoard, post: candidate }) =>
            eq(candidate.boardId, candidateBoard.id),
          "inner"
        )
        .join(
          { status: postStatusCollection },
          ({ post: candidate, status: candidateStatus }) =>
            eq(candidate.statusId, candidateStatus.id),
          "inner"
        )
        .where(({ post: candidate }) =>
          and(
            eq(candidate.organizationId, organizationId),
            eq(candidate.mergedIntoPostId, post.id)
          )
        )
        .orderBy(({ post: candidate }) => candidate.mergedAt, "desc")
        .select(({ board: candidateBoard, post: candidate, status }) => ({
          boardName: candidateBoard.name,
          boardSlug: candidateBoard.slug,
          id: candidate.id,
          slug: candidate.slug,
          statusType: status.type,
          title: candidate.title,
        })),
    [
      boardCollection,
      organizationId,
      post.id,
      postCollection,
      postStatusCollection,
    ]
  );

  const items = useMemo(
    () =>
      (mergedPosts ?? []).map((candidate) => ({
        candidate,
        label: candidate.title,
        value: candidate.id,
      })),
    [mergedPosts]
  );

  const unmerge = async (candidate: MergeCandidate) => {
    if (isPending) {
      return;
    }

    setIsPending(true);
    try {
      await unmergePost({
        payload: { organizationId, sourcePostId: candidate.id },
        reactivityKeys: { postSuggestions: [post.id, candidate.id] },
      });
      await refetchMergeData();
      trackEvent("post_unmerged", { success: true });
      toastManager.add({
        title: `Restored "${candidate.title}"`,
        type: "success",
      });
      onOpenChange(false);
    } catch {
      trackEvent("post_unmerged", { success: false });
      toastManager.add({ title: "Failed to unmerge post", type: "error" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <CommandDialog onOpenChange={onOpenChange} open>
      <CommandDialogPopup>
        <Command items={items}>
          <CommandInput placeholder="Search merged posts..." />
          <CommandPanel>
            <CommandEmpty>
              No posts have been merged into this one.
            </CommandEmpty>
            <CommandList>
              {(item: {
                candidate: MergeCandidate;
                label: string;
                value: string;
              }) => (
                <CommandItem
                  disabled={isPending}
                  key={item.value}
                  onClick={() => void unmerge(item.candidate)}
                  value={item.value}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {formatPostStatus(item.candidate.statusType)}
                  </span>
                  <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {item.candidate.boardName}
                  </span>
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
                <span>Unmerge</span>
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
