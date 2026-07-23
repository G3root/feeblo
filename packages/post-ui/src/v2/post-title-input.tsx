import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useId, useRef } from "react";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

interface PostTitleInputProps
  extends Omit<React.ComponentProps<"input">, "size"> {
  size?: "default" | "sm";
}

export function PostTitleInput({
  className,
  size = "default",
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
          "rounded-md border-none bg-transparent font-medium tracking-tight hover:bg-input/30 focus:bg-input/30 md:text-2xl",
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
  const { canManagePost, post } = usePostCollectionData();

  const defaultValue = post.title;
  const postId = post.id;
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    collections: { postCollection },
  } = usePostCollections();

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
      const tx = postCollection.update(postId, (draft) => {
        draft.title = newValue;
      });

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
