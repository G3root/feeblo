import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { PostCommentEditor, PostDescriptionEditor } from "./post-wysiwyg-editor";

type PostDetailsFormProps = {
  boardName: string;
  boardSlug: string;
  createdAt: Date;
  description: string;
  initialTitle: string;
  organizationId: string;
};

export function PostDetailsForm({
  boardName,
  boardSlug,
  createdAt,
  description,
  initialTitle,
  organizationId,
}: PostDetailsFormProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  return (
    <div className="mx-auto w-full max-w-[980px] px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">
        <div className="space-y-3">
          <Link
            className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
            params={{ organizationId, boardSlug }}
            to="/$organizationId/board/$boardSlug"
          >
            Back to {boardName}
          </Link>

          <input
            className="w-full border-0 bg-transparent p-0 font-semibold text-3xl tracking-tight outline-none placeholder:text-muted-foreground/70 md:text-4xl"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled"
            type="text"
            value={title}
          />
        </div>

        <PostDescriptionEditor content={description} />

        <div className="py-1">
          <Separator />
        </div>

        <PostCommentEditor />

        <p className="text-muted-foreground text-xs">
          Created {createdAt.toLocaleDateString()}
        </p>
      </section>
    </div>
  );
}

export function PostDetailsFormSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[980px] px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-3/5" />
        </div>

        <Skeleton className="h-28 w-full" />

        <div className="py-1">
          <Separator />
        </div>

        <Skeleton className="h-24 w-full rounded-xl" />
      </section>
    </div>
  );
}
