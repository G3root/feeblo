import { Input } from "@feeblo/ui/input";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { useId } from "react";
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

  const {
    collections: { postCollection },
  } = usePostCollections();

  const handleChange = async (value: string) => {
    // Multiple rapid changes merge into a single transaction

    if (value.trim() === "") {
      toastManager.add({ title: "Title is required", type: "error" });
      return;
    }

    try {
      const tx = postCollection.update(postId, (draft) => {
        draft.title = value;
      });

      await tx.isPersisted.promise;

      toastManager.add({
        title: "Title updated successfully",
        type: "success",
      });
    } catch (_error) {
      toastManager.add({ title: "Failed to update title", type: "error" });
    }
  };

  return (
    <PostTitleInput
      defaultValue={defaultValue}
      onBlur={canManagePost ? (e) => handleChange(e.target.value) : undefined}
      readOnly={!canManagePost}
    />
  );
}
