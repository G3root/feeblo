/** biome-ignore-all lint/performance/noBarrelFile: <explanation> */
import { PostId } from "@feeblo/id";
import { FieldRow } from "@feeblo/post-ui/post-properties";
import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState } from "react";
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
  const creationSource = store.get().context.data.source;
  const [contentEditorKey, setContentEditorKey] = useState(0);

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

      try {
        const postId = await PostId.unsafeGenerate();
        const title = value.title.trim();
        const selectedPostStatus = postStatuses.find(
          (postStatus) => postStatus.id === value.statusId
        );

        if (!selectedPostStatus) {
          throw new Error("Post status not found");
        }
        const tx = postCollection.insert({
          id: postId,
          archivedAt: null,
          boardId: value.boardId,
          title,
          slug: slugify(title) || "untitled",
          content: value.content,
          excerpt: htmlToExcerpt(value.content),
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
        trackEvent("post_created", { source: creationSource, success: true });
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
        trackEvent("post_created", { source: creationSource, success: false });
        console.error(_error);
        toastManager.add({
          title: "Failed to create post",
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
        <PostContentField form={form} key={contentEditorKey} />
        {creationSource === "public_portal" && (
          <form.Subscribe
            selector={(state) => [
              state.values.boardId,
              state.values.content,
              state.values.title,
            ]}
          >
            {([boardId, content, title]) => (
              <SimilarFeedbackSuggestions
                boardId={boardId}
                content={content}
                organizationId={organizationId}
                title={title}
              />
            )}
          </form.Subscribe>
        )}
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

function SimilarFeedbackSuggestions({
  boardId,
  content,
  organizationId,
  title,
}: {
  boardId: string;
  content: string;
  organizationId: string;
  title: string;
}) {
  const [candidates, setCandidates] = useState<
    ReadonlyArray<{
      excerpt: string;
      postId: string;
      score: number;
      slug: string;
      title: string;
    }>
  >([]);

  useEffect(() => {
    if (title.trim().length < 3) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetchRpc(
        (rpc) =>
          rpc.FeedbackSimilarPostsPublic({
            organizationId,
            ...(boardId ? { boardId } : {}),
            title,
            text: content,
          }),
        { signal: controller.signal }
      )
        .then(setCandidates)
        .catch(() => setCandidates([]));
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [boardId, content, organizationId, title]);

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="font-medium text-sm">This may already exist</p>
      <p className="mb-2 text-muted-foreground text-xs">
        Open an existing request to add your vote instead.
      </p>
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <li key={candidate.postId}>
            <a
              className="block rounded-md p-2 hover:bg-muted"
              href={`/p/${candidate.slug}`}
            >
              <span className="block font-medium text-sm">
                {candidate.title}
              </span>
              <span className="line-clamp-2 block text-muted-foreground text-xs">
                {candidate.excerpt}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
