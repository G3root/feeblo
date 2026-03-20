import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Editor } from "~/components/ui/rich-text-editor";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import type { BoardPostStatus } from "~/features/board/constants";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasMembership, usePolicy } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import {
  boardCollection,
  membersCollection,
  postCollection,
} from "~/lib/collections";
import { usePostCreateDialogContext } from "../dialog-stores";
import { PostBoardSelect } from "./post-board-select";
import { PropertyRow, StatusSelect } from "./post-details-workspace-shell";
import {
  isRichTextContentEmpty,
  uploadPostEditorImage,
} from "./post-editor-utils";
import { PostTitleInput } from "./post-title-input";

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

  const initialStatus =
    (store.get().context.data.status as BoardPostStatus | undefined) ??
    "PLANNED";

  const initialBoardId = store.get().context.data.boardId as string;

  const form = useAppForm({
    defaultValues: {
      boardId: initialBoardId,
      content: "",
      createMore: false,
      status: initialStatus,
      title: "",
    },
    validators: {
      onChange: z.object({
        boardId: z.string().trim().min(1, "Board is required"),
        content: z
          .string()
          .refine(
            (value) => !isRichTextContentEmpty(value),
            "Content is required"
          ),
        createMore: z.boolean(),
        status: z.enum([
          "PAUSED",
          "REVIEW",
          "PLANNED",
          "IN_PROGRESS",
          "COMPLETED",
          "CLOSED",
        ]),
        title: z.string().trim().min(1, "Title is required"),
      }),
    },
    onSubmit: async ({ value }) => {
      if (!canCreate) {
        return;
      }

      try {
        const postId = generateId("post");
        const title = value.title.trim();
        const tx = postCollection.insert({
          id: postId,
          boardId: value.boardId,
          title,
          slug: slugify(title) || "untitled",
          content: value.content,
          upVotes: 0,
          status: value.status,
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
          return;
        }

        form.reset();
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

  if (!canCreate) {
    return (
      <p className="text-muted-foreground text-sm">
        You must be a member of this organization to create posts.
      </p>
    );
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
        <form.Field name="title">
          {(field) => (
            <PostTitleInput
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Enter post title..."
              size="sm"
              value={field.state.value}
            />
          )}
        </form.Field>

        <form.Field name="content">
          {(field) => (
            <Editor
              enableImagePasteDrop
              onChange={field.handleChange}
              onUploadImage={uploadPostEditorImage}
              placeholder="Type '/' for commands or start typing a description..."
              value={field.state.value}
            />
          )}
        </form.Field>
      </div>

      <aside className="flex h-full w-full flex-col rounded-xl border bg-muted/40 p-3 text-sm md:min-h-150 md:w-sm md:p-4">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex-1 space-y-1.5">
            <PropertyRow label="Board">
              <form.Field name="boardId">
                {(field) => (
                  <PostBoardSelect
                    boards={boards}
                    currentBoardId={field.state.value}
                    onValueChange={(nextBoardId) => {
                      if (!nextBoardId) {
                        return;
                      }
                      field.handleChange(nextBoardId);
                    }}
                  />
                )}
              </form.Field>
            </PropertyRow>

            <PropertyRow label="Status">
              <form.Field name="status">
                {(field) => (
                  <StatusSelect
                    currentStatus={field.state.value}
                    onValueChange={(nextStatus) => {
                      if (!nextStatus) {
                        return;
                      }
                      field.handleChange(nextStatus);
                    }}
                  />
                )}
              </form.Field>
            </PropertyRow>

            {/* <button
              className="mt-1 font-medium text-muted-foreground text-xs hover:text-foreground"
              type="button"
            >
              + Add property
            </button> */}
          </div>

          <div className="mt-auto flex justify-between pt-1">
            <div className="flex items-center space-x-2">
              <form.Field name="createMore">
                {(field) => (
                  <>
                    <Switch
                      checked={field.state.value}
                      id="create-more"
                      onCheckedChange={field.handleChange}
                      size="sm"
                    />
                    <Label className="text-xs" htmlFor="create-more">
                      Create More
                    </Label>
                  </>
                )}
              </form.Field>
            </div>

            <Button form="post-create-form" size="sm" type="submit">
              Create Post
            </Button>
          </div>
        </div>
      </aside>
    </form>
  );
}
