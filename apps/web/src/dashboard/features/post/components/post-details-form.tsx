import { generateId } from "@feeblo/utils/id";
import {
  ArrowUp02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { upvoteCollection } from "~/lib/collections";
import { useCommentDeleteDialogContext } from "../dialog-stores";
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
  userId: string;
};

type PostUpvote = {
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
};

type PostDetailsFormProps = {
  boardName: string;
  boardSlug: string;
  comments: PostComment[];
  createdAt: Date;
  description: string;
  initialTitle: string;
  organizationId: string;
  postId: string;
  upvotes: PostUpvote[];
};

export function PostDetailsForm({
  boardName,
  boardSlug,
  comments,
  createdAt,
  description,
  initialTitle,
  organizationId,
  postId,
  upvotes,
}: PostDetailsFormProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">
        <PostDetailsHeader
          boardName={boardName}
          boardSlug={boardSlug}
          onTitleChange={setTitle}
          organizationId={organizationId}
          title={title}
        />

        <div className="flex items-center justify-end">
          <PostUpvoteButton
            organizationId={organizationId}
            postId={postId}
            upvotes={upvotes}
          />
        </div>

        <PostDescriptionEditor content={description} />

        <div className="py-1">
          <Separator />
        </div>

        <PostCommentEditor organizationId={organizationId} postId={postId} />

        <PostCommentList comments={comments} />

        <p className="text-muted-foreground text-xs">
          Created {createdAt.toLocaleDateString()}
        </p>
      </section>
    </div>
  );
}

function PostDetailsHeader({
  boardName,
  boardSlug,
  onTitleChange,
  organizationId,
  title,
}: {
  boardName: string;
  boardSlug: string;
  onTitleChange: (title: string) => void;
  organizationId: string;
  title: string;
}) {
  return (
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
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Untitled"
        type="text"
        value={title}
      />
    </div>
  );
}

function PostUpvoteButton({
  organizationId,
  postId,
  upvotes,
}: {
  organizationId: string;
  postId: string;
  upvotes: PostUpvote[];
}) {
  const { data: session } = authClient.useSession();
  const [isToggling, setIsToggling] = useState(false);
  const currentUserId = session?.user?.id;
  const currentUpvote = upvotes.find(
    (upvote) => upvote.userId === currentUserId
  );
  const upvoteCount = upvotes.length;

  const handleToggleUpvote = async () => {
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to upvote", type: "error" });
      return;
    }

    try {
      setIsToggling(true);
      if (currentUpvote) {
        const tx = upvoteCollection.delete(currentUpvote.id);
        await tx.isPersisted.promise;
      } else {
        const tx = upvoteCollection.insert({
          id: generateId("upvote"),
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          postId,
          userId: currentUserId,
          memberId: null,
        });
        await tx.isPersisted.promise;
      }
    } catch (_error) {
      toastManager.add({ title: "Failed to update upvote", type: "error" });
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <Button
      className="gap-2 rounded-full"
      disabled={isToggling}
      onClick={handleToggleUpvote}
      type="button"
      variant={currentUpvote ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
      <span>Upvote {upvoteCount}</span>
    </Button>
  );
}

function PostCommentList({ comments }: { comments: PostComment[] }) {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? "unknown";
  const store = useCommentDeleteDialogContext();
  if (comments.length === 0) {
    return null;
  }

  return (
    <ItemGroup>
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
          {currentUserId === comment.userId && (
            <ItemActions>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(props) => (
                    <Button {...props} size="icon-sm" variant="ghost">
                      <HugeiconsIcon icon={MoreHorizontalIcon} />
                    </Button>
                  )}
                />

                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <HugeiconsIcon icon={PencilEdit01Icon} />
                      Edit
                    </DropdownMenuItem>
                    {/* 
                  <DropdownMenuSeparator /> */}

                    <DropdownMenuItem
                      onClick={() =>
                        store.send({
                          type: "toggle",
                          data: { commentId: comment.id },
                        })
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          )}
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
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

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
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <section className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-3/5" />
        </div>

        <div className="flex justify-end">
          <Skeleton className="h-9 w-24 rounded-full" />
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
