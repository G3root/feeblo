import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { createOptimisticAction } from "@tanstack/react-db";
import { useId, useRef } from "react";

import { m } from "../paraglide/messages.js";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

interface PostTitleInputProps extends Omit<
  React.ComponentProps<"input">,
  "size"
> {
  size?: "default" | "sm";
}

export function PostTitleInput({ className, ...props }: PostTitleInputProps) {
  const generateId = useId();
  const id = props.id ?? generateId;

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {m.ideal_empty_gorilla()}
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
      toastManager.add({ title: m.ideal_spare_loris(), type: "error" });
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
        title: m.slow_blue_dingo(),
        type: "success",
      });
    } catch {
      trackEvent("post_updated", { field: "title", success: false });
      toastManager.add({ title: m.zippy_ago_chicken(), type: "error" });
      if (inputRef.current) {
        inputRef.current.value = defaultValue;
      }
    }
  };

  return (
    <PostTitleInput
      defaultValue={defaultValue}
      // Uncontrolled input: remount on post change so same-route navigation
      // (e.g. redirecting after a merge) resets the visible value instead of
      // leaving the previous post's title in the field.
      key={postId}
      onBlur={canManagePost ? handleBlur : undefined}
      readOnly={!canManagePost}
      ref={inputRef}
    />
  );
}
