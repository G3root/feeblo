import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PostPage } from "./post-page";
import {
  createPostCollectionState,
  PostCollectionStateProvider,
  usePostCollectionData,
} from "./post-page-context";

vi.mock("@feeblo/web-shared/use-auth-state", () => ({
  useAuthState: () => ({ data: null }),
}));
vi.mock("@feeblo/web-shared/use-policy", () => ({
  allPolicy: vi.fn(),
  anyPolicy: vi.fn(),
  hasMembership: vi.fn(),
  hasPermission: vi.fn(),
  isUser: vi.fn(),
  usePolicy: () => ({ allowed: false }),
}));
vi.mock("./comment-display", () => ({
  CommentsList: () => <div>comments list</div>,
}));
vi.mock("../post/post-comment-composer", () => ({
  PostCommentComposer: () => <div>comment composer</div>,
}));
vi.mock("./post-editor", () => ({
  PostContentUpdateInput: () => <div>post content</div>,
}));
vi.mock("./post-title-input", () => ({
  PostTitleUpdateInput: () => <h1>post title</h1>,
}));
vi.mock("./reaction-picker", () => ({
  PostReactionPicker: () => <div>reaction picker</div>,
}));
vi.mock("./upvote-toggle", () => ({
  UpvoteButton: ({ variant }: { variant?: string }) => (
    <button type="button">
      {variant === "compact" ? "compact vote" : "vote"}
    </button>
  ),
}));
vi.mock("./subscribe-toggle", () => ({
  SubscribeButton: () => <button type="button">subscribe</button>,
}));

const board = { visibility: "PUBLIC" } as TBoard;

function state({
  authenticated = false,
  canDelete = false,
  canManage = false,
  canModerate = false,
  locked = false,
} = {}) {
  const post = {
    archivedAt: null,
    content: "Plain post content",
    lockedAt: locked ? new Date() : null,
    mergedIntoPostId: null,
    etaQuarter: null,
  } as TPost;

  return createPostCollectionState({
    board,
    canDeletePost: canDelete,
    canManagePost: canManage,
    canModeratePost: canModerate,
    isAuthenticated: authenticated,
    isMember: authenticated,
    organizationId: "organization-id",
    pageType: "Dashboard",
    post,
  });
}

function renderState(options?: Parameters<typeof state>[0]) {
  return render(
    <PostCollectionStateProvider value={state(options)}>
      <PostPage.Guest>guest</PostPage.Guest>
      <PostPage.Authenticated>authenticated</PostPage.Authenticated>
      <PostPage.CanManage>
        {(canManagePost) => `manager: ${canManagePost}`}
      </PostPage.CanManage>
      <PostPage.Locked>locked</PostPage.Locked>
      <PostPage.Unlocked>unlocked</PostPage.Unlocked>
      <AdminControls />
    </PostCollectionStateProvider>
  );
}

/**
 * Mirrors the capability gating in `post-sidebar-actions`: Lock/Unlock is
 * driven by `canModeratePost`, Delete by `canDeletePost`. Rendered so the
 * tests can verify the two capabilities compose independently.
 */
function AdminControls() {
  const { canDeletePost, canModeratePost, isLocked } = usePostCollectionData();
  return (
    <>
      {canModeratePost ? (
        <span>{isLocked ? "Unlock post" : "Lock post"}</span>
      ) : null}
      {canDeletePost ? <span>Delete post</span> : null}
    </>
  );
}

describe("PostPage composition", () => {
  it("shows guest and unlocked content for an anonymous reader", async () => {
    const screen = await renderState();

    await expect.element(screen.getByText("guest")).toBeVisible();
    await expect.element(screen.getByText("unlocked")).toBeVisible();
    await expect.element(screen.getByText("manager: false")).toBeVisible();
    await expect
      .element(screen.getByText("authenticated"))
      .not.toBeInTheDocument();
  });

  it("shows authenticated manager content when permission is granted", async () => {
    const screen = await renderState({ authenticated: true, canManage: true });

    await expect.element(screen.getByText("authenticated")).toBeVisible();
    await expect.element(screen.getByText("manager: true")).toBeVisible();
    await expect.element(screen.getByText("guest")).not.toBeInTheDocument();
  });

  it("shows locked content instead of unlocked content", async () => {
    const screen = await renderState({ locked: true });

    await expect.element(screen.getByText("locked")).toBeVisible();
    await expect.element(screen.getByText("unlocked")).not.toBeInTheDocument();
  });

  it("shows a moderator the unlock control without the delete control", async () => {
    const screen = await renderState({
      authenticated: true,
      canManage: false,
      canModerate: true,
      locked: true,
    });

    await expect.element(screen.getByText("Unlock post")).toBeVisible();
    await expect
      .element(screen.getByText("Delete post"))
      .not.toBeInTheDocument();
  });

  it("shows a moderator the lock control without the delete control", async () => {
    const screen = await renderState({
      authenticated: true,
      canManage: false,
      canModerate: true,
    });

    await expect.element(screen.getByText("Lock post")).toBeVisible();
    await expect
      .element(screen.getByText("Delete post"))
      .not.toBeInTheDocument();
  });

  it("grants a manager the moderation control", async () => {
    const screen = await renderState({
      authenticated: true,
      canDelete: true,
      canManage: true,
      canModerate: true,
    });

    await expect.element(screen.getByText("Delete post")).toBeVisible();
    await expect.element(screen.getByText("Lock post")).toBeVisible();
    await expect
      .element(screen.getByText("Unlock post"))
      .not.toBeInTheDocument();
  });

  it("hides deletion for an engaged post author", async () => {
    const screen = await renderState({
      authenticated: true,
      canManage: true,
      canDelete: false,
    });

    await expect
      .element(screen.getByText("Delete post"))
      .not.toBeInTheDocument();
  });

  it("composes the post content, reactions, votes, and discussion", async () => {
    const screen = await render(
      <PostCollectionStateProvider
        value={state({ authenticated: true, canManage: true })}
      >
        <PostPage.Title />
        <PostPage.Content />
        <PostPage.Reactions />
        <PostPage.CompactVote />
        <PostPage.Subscribe />
        <PostPage.PublicCommentComposer />
        <PostPage.Comments />
      </PostCollectionStateProvider>
    );

    await expect
      .element(screen.getByRole("heading", { name: "post title" }))
      .toBeVisible();

    // A post author sees the editor directly, without an edit toggle.
    await expect.element(screen.getByText("post content")).toBeVisible();
    await expect
      .element(screen.getByText("Plain post content"))
      .not.toBeInTheDocument();

    await expect.element(screen.getByText("reaction picker")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "compact vote" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "subscribe" }))
      .toBeVisible();
    await expect.element(screen.getByText("comment composer")).toBeVisible();
    await expect.element(screen.getByText("comments list")).toBeVisible();
  });

  it("shows the rendered Markdown to readers who cannot edit the post", async () => {
    const screen = await render(
      <PostCollectionStateProvider value={state()}>
        <PostPage.Content />
      </PostCollectionStateProvider>
    );

    await expect.element(screen.getByText("Plain post content")).toBeVisible();
  });

  it("shows the rendered Markdown when the post is locked", async () => {
    const screen = await render(
      <PostCollectionStateProvider
        value={state({ authenticated: true, canManage: true, locked: true })}
      >
        <PostPage.Content />
      </PostCollectionStateProvider>
    );

    await expect.element(screen.getByText("Plain post content")).toBeVisible();
  });
});
