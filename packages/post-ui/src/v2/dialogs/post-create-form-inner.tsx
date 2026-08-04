/** biome-ignore-all lint/performance/noBarrelFile: <explanation> */

import type { TPost } from "@feeblo/domain/post/schema";
import { PostId } from "@feeblo/id";
import { FieldRow } from "@feeblo/post-ui/post-properties";
import { Button } from "@feeblo/ui/button";
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
import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    const normalizedTitle = title.trim();
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
        ...(boardId ? { boardId } : {}),
        content,
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
  }, [boardId, content, suggestPosts, title]);

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
      className="overflow-hidden rounded-lg border bg-muted/30"
    >
      <div className="border-b px-3 py-2">
        <p className="font-medium text-sm">Similar posts</p>
        <p className="text-muted-foreground text-xs">
          Check whether your idea already exists.
        </p>
      </div>
      <div className="divide-y">
        {posts.map((post) => {
          const href = getPostHref?.(post);
          const body = (
            <>
              <span className="font-medium text-sm">{post.title}</span>
              {post.excerpt ? (
                <span className="line-clamp-1 text-muted-foreground text-xs">
                  {post.excerpt}
                </span>
              ) : null}
            </>
          );
          return href ? (
            <a
              className="flex flex-col gap-0.5 px-3 py-2.5 transition-colors hover:bg-muted"
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
    (store.get().context.data.status as BoardPostStatus | undefined) ??
    "PLANNED";
  const initialStatusId = store.get().context.data.statusId as
    | string
    | undefined;
  const initialPostStatus =
    postStatuses.find((postStatus) => postStatus.id === initialStatusId) ??
    postStatuses.find((postStatus) => postStatus.type === initialStatus) ??
    postStatuses[0];

  const initialBoardId = store.get().context.data.boardId ?? "";
  const [contentEditorKey, setContentEditorKey] = useState(0);
  const editorScope = useRef(crypto.randomUUID()).current;

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
      } catch (_error) {
        trackEvent("post_created", { source, success: false });

        const error = parseRpcError(_error);

        toastManager.add({
          title: error.message,
          type: "error",
        });
      }
    },
  });

  if (postStatuses.length === 0) {
    return null;
  }

  return (
    <form
      className="flex h-full flex-col gap-4 md:flex-row md:items-start"
      id="post-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="flex h-full flex-1 flex-col gap-2">
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

      <aside className="flex h-full w-full flex-col rounded-xl border bg-muted/40 p-3 text-sm md:min-h-150 md:w-sm md:p-4">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex-1 space-y-1.5">
            <FieldRow label="Board">
              <PostBoardField boards={boards} form={form} />
            </FieldRow>

            <FieldRow label="Status">
              <PostStatusField form={form} statuses={postStatuses} />
            </FieldRow>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between pt-4">
          <PostCreateMoreField form={form} />
          <Button type="submit">Create Post</Button>
        </div>
      </aside>
    </form>
  );
}
