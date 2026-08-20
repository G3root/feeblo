import {
  PostCard as SharedPostCard,
} from "@feeblo/post-ui/post/post-card";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { UpvoteButton } from "@feeblo/post-ui/upvote-toggle";
import type { ReactNode } from "react";

import { truncate } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Feedback-specific augmentations — context-aware wrappers around shared primitives.
// Shared PostCard is props-driven (no context) so dashboard can use it directly.
// Public feedback/home pass data via PostCollectionDataProvider; these wrappers
// read from context when no explicit children/props are given, preserving the
// original <PostCard.Title /> / <PostCard.Link /> ergonomic while staying composable.
// No boolean props: checkbox is added by composition, homepage omits it.
// ---------------------------------------------------------------------------

function FeedbackPostCardLink({
  label,
  params,
  to,
}: {
  label?: string;
  params?: Record<string, string>;
  to?: string;
}) {
  const { post } = usePostCollectionData();
  return (
    <SharedPostCard.Link
      label={label ?? `View ${post.title}`}
      params={params ?? { slug: post.slug }}
      to={to ?? "/p/$slug"}
    />
  );
}

function FeedbackPostCardTitle({ children }: { children?: ReactNode }) {
  const { post } = usePostCollectionData();
  return <SharedPostCard.Title>{children ?? post.title}</SharedPostCard.Title>;
}

function FeedbackPostCardDescription({ children }: { children?: ReactNode }) {
  const { post } = usePostCollectionData();
  const description = truncate(post.excerpt, 100) || "No details yet.";
  return <SharedPostCard.Description>{children ?? description}</SharedPostCard.Description>;
}

function FeedbackPostCardBoardBadge({ children }: { children?: ReactNode }) {
  const { board } = usePostCollectionData();
  return <SharedPostCard.BoardBadge>{children ?? board.name}</SharedPostCard.BoardBadge>;
}

function FeedbackPostCardAuthor() {
  const { post } = usePostCollectionData();
  return <SharedPostCard.Author image={post.user.image} name={post.user.name} />;
}

function FeedbackPostCardMobileMeta({
  boardName,
  image,
  name,
}: {
  boardName?: string;
  image?: string | null;
  name?: string | null;
}) {
  const { board, post } = usePostCollectionData();
  return (
    <SharedPostCard.MobileMeta
      boardName={boardName ?? board.name}
      image={image ?? post.user.image}
      name={name ?? post.user.name}
    />
  );
}

function FeedbackPostCardUpvote() {
  return (
    <SharedPostCard.Media>
      <UpvoteButton variant="compact" />
    </SharedPostCard.Media>
  );
}

// Re-export shared composable primitives augmented for public context.
// Dashboard imports directly from @feeblo/post-ui/post/post-card and is composable without checkbox.
export const PostCard = {
  ...SharedPostCard,
  Author: FeedbackPostCardAuthor,
  BoardBadge: FeedbackPostCardBoardBadge,
  Description: FeedbackPostCardDescription,
  Link: FeedbackPostCardLink,
  MobileMeta: FeedbackPostCardMobileMeta,
  Title: FeedbackPostCardTitle,
  Upvote: FeedbackPostCardUpvote,
};

// Convenience wrapper for feedback-page / board-page reuse
export function FeedbackCard({ status }: { status: string }) {
  return (
    <PostCard.Root>
      <PostCard.Link />
      <PostCard.Upvote />
      <PostCard.Body>
        <PostCard.Title />
        <PostCard.Description />
        <PostCard.MobileMeta />
      </PostCard.Body>
      <PostCard.DesktopMeta>
        <PostCard.Status status={status} />
        <PostCard.BoardBadge />
        <PostCard.Author />
      </PostCard.DesktopMeta>
    </PostCard.Root>
  );
}

export function FeedbackCardSkeleton() {
  return <SharedPostCard.Skeleton />;
}
