import { htmlToExcerpt } from "@feeblo/utils/html";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useRef, useState } from "react";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import type { EmailEditorRef } from "@feeblo/ui/editor";
import { toastManager } from "@feeblo/ui/toast";
import type { BoardPostStatus } from "~/features/board/constants";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasMembership, usePolicy } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import {
  boardCollection,
  membersCollection,
  postCollection,
  postStatusCollection,
} from "~/lib/collections";
import { usePostCreateDialogContext } from "../dialog-stores";
import { PostCreateLayout } from "./post-create-dialog-layout";
import {
  PostBoardField,
  PostContentField,
  PostCreateMoreField,
  PostStatusField,
  PostTitleField,
  postCreateFormOpts,
} from "./post-create-form-shared";
import { PropertyRow } from "./post-properties";

export function PostCreateDialog() {
  const store = usePostCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup
        className="md:min-h-150 md:max-w-6xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Create Post</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new post in the selected board.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <PostCreateForm />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function PostCreateForm() {
  const store = usePostCreateDialogContext();
  const organizationId = useOrganizationId();
  const { data: session } = authClient.useSession();
  const { allowed: canCreate } = usePolicy(hasMembership(organizationId));

  const { data: member } = useLiveQuery(
    (q) => {
      if (!(organizationId && session?.user?.id)) {
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
  const contentEditorRef = useRef<EmailEditorRef | null>(null);

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
      if (!canCreate) {
        return;
      }

      try {
        const postId = generateId("post");
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
          upVotes: 0,
          statusId: selectedPostStatus.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          creatorId: session?.user?.id ?? null,
          creatorMemberId: member?.id ?? null,
          hasUserUpVoted: false,
          user: {
            name: session?.user?.name ?? null,
            image: session?.user?.image ?? null,
          },
        });

        await tx.isPersisted.promise;
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

  if (!canCreate) {
    return (
      <p className="text-muted-foreground text-sm">
        You must be a member of this organization to create posts.
      </p>
    );
  }

  return (
    <PostCreateLayout
      id="post-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <PostCreateLayout.Main>
        <PostTitleField form={form} />
        <PostContentField
          form={form}
          key={contentEditorKey}
          ref={contentEditorRef}
        />
      </PostCreateLayout.Main>

      <PostCreateLayout.Sidebar>
        <PostCreateLayout.SidebarBody>
          <PostCreateLayout.PropertyList>
            <PropertyRow label="Board">
              <PostBoardField boards={boards} form={form} />
            </PropertyRow>

            <PropertyRow label="Status">
              <PostStatusField form={form} statuses={postStatuses} />
            </PropertyRow>
          </PostCreateLayout.PropertyList>
        </PostCreateLayout.SidebarBody>
        <PostCreateLayout.Actions>
          <PostCreateMoreField form={form} />
          <Button type="submit">Create Post</Button>
        </PostCreateLayout.Actions>
      </PostCreateLayout.Sidebar>
    </PostCreateLayout>
  );
}
