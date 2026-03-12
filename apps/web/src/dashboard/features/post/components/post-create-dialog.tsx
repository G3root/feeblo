import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";
import { z } from "zod";
import { Editor } from "~/components/ui/rich-text-editor";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { hasMembership, usePolicy } from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import { membersCollection, postCollection } from "~/lib/collections";
import { usePostCreateDialogContext } from "../dialog-stores";
import { PostTitleInput } from "./post-title-input";
import {
  isRichTextContentEmpty,
  uploadPostEditorImage,
} from "./post-editor-utils";

export function PostCreateDialog() {
  const store = usePostCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const [createMore, setCreateMore] = useState(false);

  return (
    <Dialog onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="sr-only">Create Post</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new post in the selected board.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <PostCreateForm createMore={createMore} />
        </DialogPanel>
        <DialogFooter>
          <div className="flex w-full justify-between">
            <div className="flex items-center space-x-2">
              <Switch
                checked={createMore}
                id="create-more"
                onCheckedChange={setCreateMore}
                size="sm"
              />
              <Label className="text-xs" htmlFor="create-more">
                Create More
              </Label>
            </div>

            <Button form="post-create-form" size="sm" type="submit">
              Create Post
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PostCreateForm({ createMore }: { createMore: boolean }) {
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

  const form = useAppForm({
    defaultValues: {
      content: "",
      title: "",
    },
    validators: {
      onChange: z.object({
        content: z
          .string()
          .refine((value) => !isRichTextContentEmpty(value), "Content is required"),
        title: z.string().trim().min(1, "Title is required"),
      }),
    },
    onSubmit: async ({ value }) => {
      if (!canCreate) {
        return;
      }
      const boardId = store.get().context.data.boardId;
      const status = store.get().context.data.status;

      try {
        const postId = generateId("post");
        const title = value.title.trim();
        const tx = postCollection.insert({
          id: postId,
          boardId,
          title,
          slug: slugify(title) || "untitled",
          content: value.content,
          upVotes: 0,
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          creatorId: session?.user?.id ?? null,
          creatorMemberId: member?.id ?? null,
          user: {
            name: session?.user?.name ?? null,
          },
        });

        await tx.isPersisted.promise;
        toastManager.add({
          title: "Post created successfully",
          type: "success",
        });

        if (createMore) {
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
      id="post-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="space-y-5">
        <form.Field name="title">
          {(field) => (
            <PostTitleInput
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Untitled"
              size="sm"
              value={field.state.value}
            />
          )}
        </form.Field>

        <form.Field name="content">
          {(field) => (
            <Editor
              className="rounded-xl border"
              enableImagePasteDrop
              onChange={field.handleChange}
              onUploadImage={uploadPostEditorImage}
              placeholder="Add description..."
              value={field.state.value}
            />
          )}
        </form.Field>
      </div>
    </form>
  );
}
