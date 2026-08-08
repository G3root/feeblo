import type { TComment } from "@feeblo/domain/src/comments/schema.js";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { Card } from "@feeblo/ui/card";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  CircleLockIcon,
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
import {
  useCommentDeleteDialogContext,
  useCommentVisibilityDialogContext,
} from "./dialog-stores";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";
import { CommentReactionPicker } from "./reaction-picker";

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

type CommentDisplayState = {
  authorName: string;
  commentId: string;
  postId: string;
  postSlug: string;
  content: string;
  createdAt: Date;
  disabled: boolean;
  isAuthor: boolean;
  isEditing: boolean;
  isInternal: boolean;
};

type CommentDisplayActions = {
  onCancelEdit: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onStartEdit: () => void;
  onToggleVisibility: () => void;
  onUpdate: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
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
  postSlug: string;
  content: string;
  createdAt: Date;
  deleteLabel?: string;
  disabled?: boolean;
  editLabel?: string;
  isAuthor?: boolean;
  isEditing?: boolean;
  isInternal?: boolean;
  onCancelEdit?: () => void;
  onDelete: () => void;
  onReply: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  onStartEdit?: () => void;
  onToggleVisibility?: () => void;
  onUpdate?: (value: {
    content: string;
    isPrivate: boolean;
  }) => void | Promise<void>;
  replyLabel?: string;
  toggleToInternalLabel?: string;
  toggleToPublicLabel?: string;
};

function CommentDisplayProvider({
  children,
  authorName,
  commentId,
  postId,
  postSlug,
  content,
  createdAt,
  deleteLabel = "Delete",
  disabled = false,
  editLabel = "Edit",
  isAuthor = false,
  isEditing = false,
  isInternal = false,
  onCancelEdit = () => undefined,
  onDelete,
  onReply,
  onStartEdit = () => undefined,
  onToggleVisibility = () => undefined,
  onUpdate = () => undefined,
  replyLabel = "Reply",
  toggleToInternalLabel = "Make internal",
  toggleToPublicLabel = "Make public",
}: CommentDisplayProviderProps) {
  return (
    <CommentDisplayContext
      value={{
        actions: {
          onCancelEdit,
          onDelete,
          onReply,
          onStartEdit,
          onToggleVisibility,
          onUpdate,
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
          isEditing,
          isInternal,
          postId,
          postSlug,
        },
      }}
    >
      {children}
    </CommentDisplayContext>
  );
}

function CommentDisplayAvatar() {
  const { state } = useCommentDisplay();

  return <UserAvatar name={state.authorName} size="sm" />;
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
        <Badge variant="info">
          <HugeiconsIcon icon={CircleLockIcon} /> Internal
        </Badge>
      )}
    </div>
  );
}

function CommentDisplayBody() {
  const { state } = useCommentDisplay();

  if (state.isEditing) {
    return <CommentDisplayEditForm />;
  }

  return <MarkdownContent className="mt-1 text-sm" content={state.content} />;
}

function CommentDisplayEditForm() {
  const { actions, state } = useCommentDisplay();
  const [content, setContent] = useState(state.content);
  const [isPrivate, setIsPrivate] = useState(state.isInternal);

  return (
    <div className="mt-2">
      <CommentComposer
        content={content}
        isPrivate={isPrivate}
        onCancel={actions.onCancelEdit}
        onContentChange={setContent}
        onSubmit={async ({
          content: submittedContent,
          isPrivate: submittedIsPrivate,
        }) => {
          await actions.onUpdate({
            content: submittedContent,
            isPrivate: submittedIsPrivate,
          });
          actions.onCancelEdit();
        }}
        onVisibilityChange={setIsPrivate}
        showVisibilityToggle={false}
        submitLabel="Save"
      />
    </div>
  );
}

function CommentDisplayActions() {
  const { actions, state } = useCommentDisplay();
  const [isReplying, setIsReplying] = useState(false);

  if (state.isEditing) {
    return null;
  }

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
          postSlug={state.postSlug}
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

function DeleteButton() {
  const store = useCommentDeleteDialogContext();
  const { meta, state } = useCommentDisplay();

  return (
    <MenuItem
      onClick={() =>
        store.send({
          type: "toggle",
          data: {
            commentId: state.commentId,
          },
        })
      }
    >
      <HugeiconsIcon icon={Delete02Icon} />
      {meta.deleteLabel}
    </MenuItem>
  );
}

function EditButton() {
  const { actions, meta } = useCommentDisplay();

  return (
    <MenuItem onClick={actions.onStartEdit}>
      <HugeiconsIcon icon={Edit01Icon} />
      {meta.editLabel}
    </MenuItem>
  );
}

function ToggleVisibilityButton() {
  const postData = usePostCollectionData();
  const store = useCommentVisibilityDialogContext();
  const { meta, state } = useCommentDisplay();

  if (!postData.isMember) {
    return null;
  }

  return (
    <MenuItem
      onClick={() =>
        store.send({
          type: "toggle",
          data: {
            commentId: state.commentId,
            isInternal: state.isInternal,
          },
        })
      }
    >
      <HugeiconsIcon icon={state.isInternal ? EyeIcon : ViewOffIcon} />
      {state.isInternal ? meta.toggleToPublicLabel : meta.toggleToInternalLabel}
    </MenuItem>
  );
}

function CommentDisplayDropdown() {
  const { canModeratePost } = usePostCollectionData();
  const { state } = useCommentDisplay();

  if (!(canModeratePost || state.isAuthor)) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="icon-sm" variant="ghost">
            <HugeiconsIcon icon={Ellipsis} />
          </Button>
        }
      />
      <MenuPopup>
        {state.isAuthor ? <EditButton /> : null}
        {state.isAuthor ? <ToggleVisibilityButton /> : null}
        <DeleteButton />
      </MenuPopup>
    </Menu>
  );
}

type CommentDisplayRootProps = Omit<CommentDisplayProviderProps, "children"> & {
  children?: never;
};

function CommentDisplayComponent(props: CommentDisplayRootProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <CommentDisplayProvider
      {...props}
      isEditing={isEditing}
      onCancelEdit={() => setIsEditing(false)}
      onStartEdit={() => setIsEditing(true)}
    >
      <Card>
        <div className="flex items-start gap-3 p-4">
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
      </Card>
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

export function CommentsList() {
  const { data: session } = useAuthState();
  const { organizationId, post } = usePostCollectionData();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const postSlug = post.slug;

  const { data: comments, isLoading: isCommentsLoading } = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postSlug, postSlug)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [organizationId, postSlug]
  );

  if (isCommentsLoading) {
    return null;
  }

  return comments.map((data) => (
    <CommentDisplayitem
      currentUserId={session?.user?.id}
      data={data}
      key={data.id}
    />
  ));
}

interface CommentDisplayItemProps {
  currentUserId?: string;
  data: TComment;
}

function CommentDisplayitem({ data, currentUserId }: CommentDisplayItemProps) {
  const {
    collections: { commentCollection },
  } = usePostCollections();

  return (
    <CommentDisplayComponent
      authorName={data.user.name}
      commentId={data.id}
      content={data.content}
      createdAt={data.createdAt}
      isAuthor={currentUserId ? data.userId === currentUserId : false}
      isInternal={data.visibility === "INTERNAL"}
      onDelete={() => {}}
      onReply={() => {}}
      onUpdate={async ({ content, isPrivate }) => {
        const tx = commentCollection.update(data.id, (draft) => {
          draft.content = content;
          draft.visibility = isPrivate ? "INTERNAL" : "PUBLIC";
        });
        await tx.isPersisted.promise;
      }}
      postId={data.postId}
      postSlug={data.postSlug}
    />
  );
}
