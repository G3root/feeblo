import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { createOptimisticAction } from "@tanstack/react-db";
import { useId, useRef } from "react";

import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

interface PostTitleInputProps extends Omit<
  React.ComponentProps<"input">,
  "size"
> {
  size?: "default" | "sm";
}

export function PostTitleInput({
  className,
  ...props
}: PostTitleInputProps) {
  const generateId = useId();
  const id = props.id ?? generateId;

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        Post Title
      </label>
      <Input
        className={cn(
          "hover:bg-input/30 focus:bg-input/30 rounded-md border-none bg-transparent font-medium tracking-tight md:text-2xl",
          className
        )}
        {...props}
        id={id}
        type="text"
      />
    </>
  );
}

export function PostTitleUpdateInput() {
  const { canManagePost, post, pageType } = usePostCollectionData();
  const {
    collections: { postCollection },
    organizationId,
  } = usePostCollections();

  const defaultValue = post.title;
  const postId = post.id;
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePostTitle = createOptimisticAction<{ title: string }>({
    onMutate: ({ title }) => {
      postCollection.update(postId, (draft) => {
        draft.title = title;
      });
    },
    mutationFn: async ({ title }) => {
      await fetchRpc((rpc) =>
        pageType === "Dashboard"
          ? rpc.PostUpdateTitle({
              id: postId,
              boardId: post.boardId,
              organizationId,
              title,
            })
          : rpc.PostUpdateTitlePublic({
              id: postId,
              boardId: post.boardId,
              organizationId,
              title,
            })
      );
      await postCollection.utils.refetch();
    },
  });

  const handleBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    //TODO add debounce. later
    if (newValue === defaultValue) {
      return;
    }

    if (newValue.trim() === "") {
      toastManager.add({ title: "Title is required", type: "error" });
      if (inputRef.current) {
        inputRef.current.value = defaultValue;
      }
      return;
    }

    try {
      const tx = updatePostTitle({ title: newValue });

      await tx.isPersisted.promise;
      trackEvent("post_updated", { field: "title", success: true });

      toastManager.add({
        title: "Title updated successfully",
        type: "success",
      });
    } catch {
      trackEvent("post_updated", { field: "title", success: false });
      toastManager.add({ title: "Failed to update title", type: "error" });
      if (inputRef.current) {
        inputRef.current.value = defaultValue;
      }
    }
  };

  return (
    <PostTitleInput
      defaultValue={defaultValue}
      onBlur={canManagePost ? handleBlur : undefined}
      readOnly={!canManagePost}
      ref={inputRef}
    />
  );
}
