import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import {
  PostCommentEditor,
  PostDescriptionEditor,
} from "./post-wysiwyg-editor";

type PostComment = {
  id: string;
  content: string;
  createdAt: Date | string;
  user: {
    name: string;
  };
};

type PostDetailsFormProps = {
  boardName: string;
  boardSlug: string;
  comments: PostComment[];
  createdAt: Date;
  description: string;
  initialTitle: string;
  organizationId: string;
};

export function PostDetailsForm({
  boardName,
  boardSlug,
  comments,
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

        <PostCommentList comments={comments} />

        <p className="text-muted-foreground text-xs">
          Created {createdAt.toLocaleDateString()}
        </p>
      </section>
    </div>
  );
}

function PostCommentList({ comments }: { comments: PostComment[] }) {
  if (comments.length === 0) {
    return null;
  }

  return (
    <ItemGroup className="gap-2">
      {comments.map((comment) => (
        <Item
          className="rounded-xl border-border/80 px-4 py-3"
          key={comment.id}
          variant="outline"
        >
          <ItemMedia
            className="size-6 rounded-full bg-blue-500 text-white text-xs"
            variant="default"
          >
            {comment.user.name.charAt(0)}
          </ItemMedia>
          <ItemContent className="gap-2">
            <ItemHeader className="justify-start gap-2">
              <ItemTitle className="font-medium text-sm">
                {comment.user.name}
              </ItemTitle>
              <span className="text-muted-foreground text-sm">
                {formatRelativeTime(comment.createdAt)}
              </span>
            </ItemHeader>
            <ItemDescription className="line-clamp-none text-foreground">
              {comment.content}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
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
