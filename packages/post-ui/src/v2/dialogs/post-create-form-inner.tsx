import type { TPost } from "@feeblo/domain/post/schema";
import { PostId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { DialogFooter, DialogPanel } from "@feeblo/ui/dialog";
import { finalizeEditorContent } from "@feeblo/ui/editor";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import {
  type FormEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
} from "react";

import { usePostCreateDialogContext } from "../dialog-stores/post";
import {
  PostBoardField,
  PostContentField,
  PostCreateMoreField,
  PostStatusField,
  PostTitleField,
  postCreateFormOpts,
} from "../forms/post-create-form-shared";
import { usePostCollections } from "../providers/post-collections-provider";

const SUGGESTIONS_DEBOUNCE_MS = 450;

function SimilarPosts({
  boardId,
  content,
  title,
}: {
  boardId: string;
  content: string;
  title: string;
}) {
  const { getPostHref, suggestPosts } = usePostCollections();
  const [posts, setPosts] = useState<readonly TPost[]>([]);
  const [loading, setLoading] = useState(false);
  // Defer the expensive inputs off the urgent typing path: the editor stays
  // responsive while suggestions settle a beat behind.
  const deferredTitle = useDeferredValue(title);
  const deferredContent = useDeferredValue(content);

  useEffect(() => {
    const normalizedTitle = deferredTitle.trim();
    if (!suggestPosts || normalizedTitle.length < 3) {
      setPosts([]);
      setLoading(false);
      return;
    }

    // Preserve matching posts while the next query settles. Resetting them on
    // each keystroke unmounted the panel and caused it to flash.
    const controller = new AbortController();
    let isCurrent = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      suggestPosts({
        ...(boardId && { boardId }),
        content: deferredContent,
        signal: controller.signal,
        title: normalizedTitle,
      })
        .then((nextPosts) => {
          if (isCurrent) {
            setPosts(nextPosts);
          }
        })
        .catch(() => {
          if (isCurrent && !controller.signal.aborted) {
            setPosts([]);
          }
        })
        .finally(() => {
          if (isCurrent) {
            setLoading(false);
          }
        });
    }, SUGGESTIONS_DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [boardId, deferredContent, suggestPosts, deferredTitle]);

  // Do not render an empty/loading panel. If the request returns no matches,
  // the suggestions area should stay absent instead of flashing briefly.
  if (posts.length === 0) {
    return null;
  }

  return (
    <section
      aria-busy={loading}
      aria-label="Similar posts"
      aria-live="polite"
      className="bg-muted/30 overflow-hidden rounded-lg border"
    >
      <div className="border-b px-3 py-2">
        <p className="text-sm font-medium">Similar posts</p>
        <p className="text-muted-foreground text-xs">
          Check whether your idea already exists.
        </p>
      </div>
      <div className="divide-y">
        {posts.map((post) => {
          const href = getPostHref?.(post);
          const body = (
            <>
              <span className="text-sm font-medium">{post.title}</span>
              {post.excerpt ? (
                <span className="text-muted-foreground line-clamp-1 text-xs">
                  {post.excerpt}
                </span>
              ) : null}
            </>
          );
          return href ? (
            <a
              className="hover:bg-muted flex flex-col gap-0.5 px-3 py-2.5 transition-colors"
              href={href}
              key={post.id}
            >
              {body}
            </a>
          ) : (
            <div className="flex flex-col gap-0.5 px-3 py-2.5" key={post.id}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PostCreateForm() {
  const store = usePostCreateDialogContext();
  const { collections, onAuthRequired, organizationId } = usePostCollections();
  const {
    boardCollection,
    membersCollection,
    postCollection,
    postStatusCollection,
  } = collections;
  const { data: session } = useAuthState();

  const { data: member } = useLiveQuery(
    (q) => {
      if (!(membersCollection && organizationId && session?.user?.id)) {
        return undefined;
      }
      return q
        .from({ member: membersCollection })
        .where(({ member }) =>
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, session?.user?.id)
          )
        )
        .findOne();
    },
    [organizationId, session?.user?.id]
  );

  const { data: boards = [] } = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }
      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId));
    },
    [organizationId]
  );
  const { data: postStatuses = [] } = useLiveQuery(
    (q) => {
      if (!organizationId) {
        return undefined;
      }

      return q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        );
    },
    [organizationId]
  );

  const initialStatus =
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    (store.get().context.data.status as BoardPostStatus | undefined) ??
    "PLANNED";
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const initialStatusId = store.get().context.data.statusId as
    | string
    | undefined;
  const initialPostStatus =
    postStatuses.find((postStatus) => postStatus.id === initialStatusId) ??
    postStatuses.find((postStatus) => postStatus.type === initialStatus) ??
    postStatuses[0];

  const initialBoardId = store.get().context.data.boardId ?? "";
  const [contentEditorKey, setContentEditorKey] = useState(0);
  const [editorScope] = useState(() => crypto.randomUUID());

  const form = useAppForm({
    ...postCreateFormOpts,
    defaultValues: {
      boardId: initialBoardId,
      content: "",
      createMore: false,
      statusId: initialPostStatus?.id ?? "",
      title: "",
    },

    onSubmit: async ({ value }) => {
      if (!session) {
        onAuthRequired?.();
        return;
      }

      const source = store.get().context.data.source;

      try {
        const postId = await PostId.unsafeGenerate();
        const title = value.title.trim();
        const assetOrganizationId = member ? organizationId : undefined;
        const finalized = await finalizeEditorContent(
          value.content,
          assetOrganizationId,
          { scope: editorScope }
        );
        const { assetIds, content } = finalized;
        const selectedPostStatus = postStatuses.find(
          (postStatus) => postStatus.id === value.statusId
        );

        if (!selectedPostStatus) {
          throw new Error("Post status not found");
        }
        const tx = postCollection.insert({
          id: postId,
          assetIds,
          archivedAt: null,
          boardId: value.boardId,
          title,
          slug: slugify(title) || "untitled",
          content,
          excerpt: htmlToExcerpt(content),
          lockedAt: null,
          mergedAt: null,
          mergedIntoPostId: null,
          etaQuarter: null,
          statusId: selectedPostStatus.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          creatorId: session?.user?.id ?? null,
          creatorMemberId: member?.id ?? null,
          user: {
            name: session?.user?.name ?? null,
            image: session?.user?.image ?? null,
          },
        });

        await tx.isPersisted.promise;
        finalized.commit();
        await postCollection.utils.refetch().catch(() => undefined);
        trackEvent("post_created", { source, success: true });
        toastManager.add({
          title: "Post created successfully",
          type: "success",
        });

        if (value.createMore) {
          form.resetField("title");
          form.resetField("content");
          setContentEditorKey((current) => current + 1);
          return;
        }

        form.reset();
        setContentEditorKey((current) => current + 1);
        store.send({ type: "toggle" });
      } catch (error) {
        trackEvent("post_created", { source, success: false });

        const parsed = parseRpcError(error);

        toastManager.add({
          title: parsed.message,
          type: "error",
        });
      }
    },
  });

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      form.handleSubmit();
    },
    [form]
  );

  if (postStatuses.length === 0) {
    return null;
  }

  return (
    <form className="contents" id="post-create-form" onSubmit={handleSubmit}>
      <DialogPanel>
        <div className="space-y-4">
          <PostTitleField form={form} />
          <PostContentField
            assetOwner={member ? "organization" : "user"}
            editorScope={editorScope}
            form={form}
            key={contentEditorKey}
          />
          <form.Subscribe
            selector={(state) =>
              [
                state.values.boardId,
                state.values.content,
                state.values.title,
              ] as const
            }
          >
            {([boardId, content, title]) => (
              <SimilarPosts boardId={boardId} content={content} title={title} />
            )}
          </form.Subscribe>
        </div>
      </DialogPanel>

      <DialogFooter className="grid grid-cols-2 items-center">
        <div className="flex justify-start">
          <div className="flex gap-2">
            <PostBoardField boards={boards} form={form} />
            <PostStatusField form={form} statuses={postStatuses} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <PostCreateMoreField form={form} />
          <Button type="submit" variant="brand">
            Create Post
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
