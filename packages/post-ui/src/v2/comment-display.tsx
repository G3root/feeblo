import type { TComment } from "@feeblo/domain/src/comments/schema.js";
import { Avatar, AvatarFallback } from "@feeblo/ui/avatar";
import { Button } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import {
  Delete02Icon,
  Edit01Icon,
  Ellipsis,
  EyeIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useState } from "react";
import { CommentComposer } from "./comment-composer";
import { usePostCollections } from "./providers/post-collections-provider";
import { CommentReactionPicker } from "./reaction-picker";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const WHITESPACE_REGEX = /\s+/;

function getInitials(name: string | null | undefined) {
  const normalized = name?.trim();

  if (!normalized) {
    return "??";
  }

  const segments = normalized.split(WHITESPACE_REGEX).slice(0, 2);
  return segments.map((segment) => segment.charAt(0).toUpperCase()).join("");
}

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

type CommentDisplayState = {
  authorName: string;
  commentId: string;
  postId: string;
  content: string;
  createdAt: Date;
  disabled: boolean;
  isAuthor: boolean;
  isInternal: boolean;
};

type CommentDisplayActions = {
  onDelete: () => void;
  onEdit: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onToggleVisibility: () => void;
};

type CommentDisplayMeta = {
  deleteLabel: string;
  editLabel: string;
  replyLabel: string;
  toggleToInternalLabel: string;
  toggleToPublicLabel: string;
};

type CommentDisplayContextValue = {
  actions: CommentDisplayActions;
  meta: CommentDisplayMeta;
  state: CommentDisplayState;
};

const CommentDisplayContext = createContext<CommentDisplayContextValue | null>(
  null
);

function useCommentDisplay() {
  const value = use(CommentDisplayContext);

  if (!value) {
    throw new Error("CommentDisplay components must be used within Provider.");
  }

  return value;
}

type CommentDisplayProviderProps = {
  children?: ReactNode;
  authorName: string;
  commentId: string;
  postId: string;
  content: string;
  createdAt: Date;
  deleteLabel?: string;
  disabled?: boolean;
  editLabel?: string;
  isAuthor?: boolean;
  isInternal?: boolean;
  onDelete: () => void;
  onEdit?: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onToggleVisibility?: () => void;
  replyLabel?: string;
  toggleToInternalLabel?: string;
  toggleToPublicLabel?: string;
};

function CommentDisplayProvider({
  children,
  authorName,
  commentId,
  postId,
  content,
  createdAt,
  deleteLabel = "Delete",
  disabled = false,
  editLabel = "Edit",
  isAuthor = false,
  isInternal = false,
  onDelete,
  onEdit = () => {},
  onReply,
  onToggleVisibility = () => {},
  replyLabel = "Reply",
  toggleToInternalLabel = "Make internal",
  toggleToPublicLabel = "Make public",
}: CommentDisplayProviderProps) {
  return (
    <CommentDisplayContext
      value={{
        actions: {
          onDelete,
          onEdit,
          onReply,
          onToggleVisibility,
        },
        meta: {
          deleteLabel,
          editLabel,
          replyLabel,
          toggleToInternalLabel,
          toggleToPublicLabel,
        },
        state: {
          authorName,
          commentId,
          content,
          createdAt,
          disabled,
          isAuthor,
          isInternal,
          postId,
        },
      }}
    >
      {children}
    </CommentDisplayContext>
  );
}

function CommentDisplayAvatar() {
  const { state } = useCommentDisplay();

  return (
    <Avatar size="sm">
      <AvatarFallback>{getInitials(state.authorName)}</AvatarFallback>
    </Avatar>
  );
}

function CommentDisplayHeader() {
  const { state } = useCommentDisplay();

  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-sm">{state.authorName}</span>
      <span className="text-muted-foreground text-xs">
        {formatRelativeTime(state.createdAt)}
      </span>
      {state.isInternal && (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-xs">
          Internal
        </span>
      )}
    </div>
  );
}

function CommentDisplayBody() {
  const { state } = useCommentDisplay();

  return (
    <div
      className="mt-1 text-sm [&_p]:my-0.5"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized HTML content
      dangerouslySetInnerHTML={{ __html: state.content }}
    />
  );
}

function CommentDisplayActions() {
  const { actions, state } = useCommentDisplay();
  const [isReplying, setIsReplying] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 pt-2">
        {/* <Button
          disabled={state.disabled}
          onClick={() => setIsReplying((prev) => !prev)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={MailReply01Icon} />
          {isReplying ? "Hide reply" : meta.replyLabel}
        </Button> */}
        <CommentReactionPicker
          commentId={state.commentId}
          disabled={state.disabled}
          postId={state.postId}
        />
      </div>

      {isReplying && (
        <div className="pt-2">
          <CommentComposer
            onSubmit={async (value) => {
              await actions.onReply(value);
              setIsReplying(false);
            }}
          />
        </div>
      )}
    </>
  );
}

function CommentDisplayDropdown() {
  const { actions, meta, state } = useCommentDisplay();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button disabled={state.disabled} size="icon-sm" variant="ghost">
            <HugeiconsIcon icon={Ellipsis} />
          </Button>
        }
      />
      <DropdownMenuContent>
        <DropdownMenuItem onClick={actions.onEdit}>
          <HugeiconsIcon icon={Edit01Icon} />
          {meta.editLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onToggleVisibility}>
          <HugeiconsIcon icon={state.isInternal ? EyeIcon : ViewOffIcon} />
          {state.isInternal
            ? meta.toggleToPublicLabel
            : meta.toggleToInternalLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onDelete}>
          <HugeiconsIcon icon={Delete02Icon} />
          {meta.deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type CommentDisplayRootProps = Omit<CommentDisplayProviderProps, "children"> & {
  children?: never;
};

function CommentDisplayComponent(props: CommentDisplayRootProps) {
  return (
    <CommentDisplayProvider {...props}>
      <div
        className={
          props.isInternal
            ? "rounded-2xl border border-border bg-primary/5 p-4"
            : "rounded-2xl border border-border p-4"
        }
      >
        <div className="flex items-start gap-3">
          <CommentDisplayAvatar />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between">
              <CommentDisplayHeader />
              <CommentDisplayDropdown />
            </div>
            <CommentDisplayBody />
            <CommentDisplayActions />
          </div>
        </div>
      </div>
    </CommentDisplayProvider>
  );
}

export const CommentDisplay = Object.assign(CommentDisplayComponent, {
  Actions: CommentDisplayActions,
  Avatar: CommentDisplayAvatar,
  Body: CommentDisplayBody,
  Dropdown: CommentDisplayDropdown,
  Header: CommentDisplayHeader,
  Provider: CommentDisplayProvider,
});

interface CommentsListProps {
  postId: string;
}

export function CommentsList({ postId }: CommentsListProps) {
  const {
    collections: { commentCollection },
    organizationId,
  } = usePostCollections();
  const { data: comments, isLoading: isCommentsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postId, postId)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [organizationId, postId]
  );

  if (isCommentsLoading) {
    return null;
  }

  return comments.map((data) => (
    <CommentDisplayitem data={data} key={data.id} />
  ));
}

interface CommentDisplayItemProps {
  data: TComment;
}

function CommentDisplayitem({ data }: CommentDisplayItemProps) {
  return (
    <CommentDisplayComponent
      authorName={data.user.name}
      commentId={data.id}
      content={data.content}
      createdAt={data.createdAt}
      isInternal={data.visibility === "INTERNAL"}
      postId={data.postId}
    />
  );
}
