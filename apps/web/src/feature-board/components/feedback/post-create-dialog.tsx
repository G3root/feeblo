import { htmlToExcerpt } from "@feeblo/utils/html";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { useStore } from "@nanostores/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
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
import { PostCreateLayout } from "~/features/post/components/post-create-dialog-layout";
import {
  PostBoardField,
  PostContentField,
  PostCreateMoreField,
  PostStatusField,
  PostTitleField,
  postCreateFormOpts,
} from "~/features/post/components/post-create-form-shared";
import { PropertyRow } from "~/features/post/components/post-properties";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";
import { closePostCreateDialog, postCreateDialogStore } from "../../stores";

export function PostCreateDialog() {
  const { initialBoardId, isOpen } = useStore(postCreateDialogStore);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closePostCreateDialog();
        }
      }}
      open={isOpen}
    >
      <DialogPopup
        className="md:min-h-150 md:max-w-6xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Give Feedback</DialogTitle>
          <DialogDescription className="sr-only">
            Share feedback with this workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <PostCreateForm
            initialBoardId={initialBoardId}
            key={initialBoardId}
            onComplete={closePostCreateDialog}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function PostCreateForm({
  initialBoardId,
  onComplete,
}: {
  initialBoardId: string;
  onComplete: () => void;
}) {
  const site = useSite();
  const { data: session } = authClient.useSession();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
  } = usePublicCollections();
  const [contentEditorKey, setContentEditorKey] = useState(0);
  const contentEditorRef = useRef<EmailEditorRef | null>(null);

  const { data: boards = [] } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId))
        .orderBy(({ board }) => board.name, "asc"),
    [site.organizationId]
  );

  const { data: postStatuses = [] } = useLiveQuery(
    (q) =>
      q
        .from({ postStatus: publicPostStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, site.organizationId)
        ),
    [site.organizationId]
  );

  const initialPostStatus =
    postStatuses.find((postStatus) => postStatus.type === "PLANNED") ??
    postStatuses[0];

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
      if (!session?.user?.id) {
        toastManager.add({
          title: "Sign in to give feedback",
          type: "error",
        });
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

        const tx = publicPostCollection.insert({
          archivedAt: null,
          id: postId,
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
          organizationId: site.organizationId,
          creatorId: session.user.id,
          creatorMemberId: null,
          hasUserUpVoted: false,
          user: {
            name: session.user.name ?? null,
            image: session.user.image ?? null,
          },
        });
        await tx.isPersisted.promise;
        toastManager.add({
          title: "Feedback submitted",
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
        onComplete();
      } catch (_error) {
        console.error(_error);
        toastManager.add({
          title: "Failed to submit feedback",
          type: "error",
        });
      }
    },
  });

  if (boards.length === 0 || postStatuses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Feedback is not ready for this workspace yet.
      </p>
    );
  }

  return (
    <PostCreateLayout
      id="public-post-create-form"
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
          <Button type="submit">Submit Feedback</Button>
        </PostCreateLayout.Actions>
      </PostCreateLayout.Sidebar>
    </PostCreateLayout>
  );
}
