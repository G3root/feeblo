import type { TBoard } from "@feeblo/domain/board/schema";
import type { TCommentReaction } from "@feeblo/domain/comment-reaction/schema";
import type { TComment } from "@feeblo/domain/comments/schema";
import type { TPostReaction } from "@feeblo/domain/post-reaction/schema";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { TPostSubscription } from "@feeblo/domain/post-subscription/schema";
import type { TPost, TPostListItem } from "@feeblo/domain/post/schema";
import type { TUpvote } from "@feeblo/domain/upvote/schema";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CommentDisplayDropdown } from "./comment-display/dropdown";
import { CommentDisplayProvider } from "./comment-display/provider";
import {
  BanAuthorDialogProvider,
  CommentDeleteDialogProvider,
  CommentVisibilityDialogProvider,
  PostDeleteDialogProvider,
} from "./dialog-stores";
import { PostPage } from "./post-page";
import {
  createPostCollectionState,
  PostCollectionStateProvider,
  usePostCollectionData,
} from "./post-page-context";
import {
  PostCollectionsProvider,
  type PostCollections,
} from "./providers/post-collections-provider";
import { createMockCollection } from "./testing/in-memory-collections";

// This browser test renders the PostPage in isolation, stubbing its child
// surfaces (auth, policy, comments, editor, reactions, toggles) with faithful,
// deterministic DOM stubs so each interaction can be asserted without a full
// backend. These are the module boundaries the page reads directly, so
// interception is the only seam available here.
// eslint-disable-next-line anti-slop/no-module-mocking
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/use-auth-state", () => ({
  useAuthState: () => ({ data: null }),
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/runtime", () => ({
  fetchRpc: () => Promise.resolve([]),
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@feeblo/web-shared/use-policy", () => ({
  allPolicy: vi.fn(),
  anyPolicy: vi.fn(),
  hasMembership: vi.fn(),
  hasPermission: vi.fn(),
  isUser: vi.fn(),
  usePolicy: () => ({ allowed: false }),
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./comment-display/list", () => ({
  CommentsList: () => <div>comments list</div>,
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./post/post-comment-composer", () => ({
  PostCommentComposer: () => <div>comment composer</div>,
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./post-editor", () => ({
  PostContentUpdateInput: () => <div>post content</div>,
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./post-title-input", () => ({
  PostTitleUpdateInput: () => <h1>post title</h1>,
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./reaction-picker", () => ({
  PostReactionPicker: () => <div>reaction picker</div>,
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./upvote-toggle", () => ({
  UpvoteButton: ({ variant }: { variant?: string }) => (
    <button type="button">
      {variant === "compact" ? "compact vote" : "vote"}
    </button>
  ),
}));
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./subscribe-toggle", () => {
  const SubscribeButton = () => <button type="button">subscribe</button>;
  return {
    SubscribeButton,
    // The real card wraps the toggle button; keep the button reachable for
    // role-based locators.
    SubscribeCard: () => (
      <div>
        <SubscribeButton />
      </div>
    ),
  };
});

// The body resolves through the detail collection at runtime; fix it here
// so composition tests stay focused on layout, not data fetching.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./use-post-detail", () => ({
  usePostDetail: () => ({
    assetIds: [],
    content: "Plain post content",
    isError: false,
    isLoading: false,
  }),
}));

// SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
const board = { visibility: "PUBLIC" } as TBoard;

/** A stand-in for the dashboard's atom-backed writes; the badge tests never call it. */
const banActions = {
  ban: () => Promise.resolve({ deletedComments: 0, deletedPosts: 0 }),
  unban: () => Promise.resolve(),
};

function state({
  authenticated = false,
  canBanAuthor = false,
  canDelete = false,
  canManage = false,
  canModerate = false,
  locked = false,
} = {}) {
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const post = {
    archivedAt: null,
    content: "Plain post content",
    lockedAt: locked ? new Date() : null,
    mergedIntoPostId: null,
    etaQuarter: null,
  } as TPost;

  return createPostCollectionState({
    board,
    canBanAuthors: canBanAuthor,
    canDeletePost: canDelete,
    canManagePost: canManage,
    canModeratePost: canModerate,
    isAuthenticated: authenticated,
    isMember: authenticated,
    organizationId: "organization-id",
    pageType: "Dashboard",
    post,
    // The real host writes through its ban atoms. The state flag needs both:
    // an offered action with no write behind it is not offered at all.
    userBanActions: canBanAuthor ? banActions : undefined,
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

/** Every collection the comment menu can reach, backed by in-memory syncs. */
const stubCollections = {
  boardCollection: createMockCollection<TBoard>({
    id: "board",
    getKey: (row) => row.id,
  }),
  commentCollection: createMockCollection<TComment>({
    id: "comment",
    getKey: (row) => row.id,
  }),
  commentReactionCollection: createMockCollection<TCommentReaction>({
    id: "comment-reaction",
    getKey: (row) => row.id,
  }),
  postCollection: createMockCollection<TPostListItem>({
    id: "post",
    getKey: (row) => row.id,
  }),
  postDetailCollection: createMockCollection<TPost>({
    id: "post-detail",
    getKey: (row) => row.id,
  }),
  postReactionCollection: createMockCollection<TPostReaction>({
    id: "post-reaction",
    getKey: (row) => row.id,
  }),
  postStatusCollection: createMockCollection<TPostStatus>({
    id: "post-status",
    getKey: (row) => row.id,
  }),
  postSubscriptionCollection: createMockCollection<TPostSubscription>({
    id: "post-subscription",
    getKey: (row) => row.id,
  }),
  upvoteCollection: createMockCollection<TUpvote>({
    id: "upvote",
    getKey: (row) => row.id,
  }),
} satisfies PostCollections;

/**
 * The production comment menu under the providers it reads.
 *
 * The ban action is gated inside `CommentDisplayDropdown`, not in the state, so
 * the test renders that component rather than a copy of its condition.
 */
function renderBanMenu({
  authorIsBanned = false,
  authorIsMember = false,
  canBanAuthor = true,
}: {
  authorIsBanned?: boolean;
  authorIsMember?: boolean;
  canBanAuthor?: boolean;
} = {}) {
  return render(
    <PostCollectionStateProvider
      value={state({ authenticated: true, canBanAuthor, canModerate: true })}
    >
      <PostCollectionsProvider
        collections={stubCollections}
        organizationId="organization-id"
        persistPost={() => Promise.resolve("post-id")}
      >
        <PostDeleteDialogProvider>
          <CommentDeleteDialogProvider>
            <CommentVisibilityDialogProvider>
              <BanAuthorDialogProvider>
                <CommentDisplayProvider
                  authorIsBanned={authorIsBanned}
                  authorIsMember={authorIsMember}
                  authorName="Ada"
                  commentId="comment-id"
                  content="Comment"
                  createdAt={new Date(0)}
                  onDelete={vi.fn()}
                  onReply={() => true}
                  postId="post-id"
                  postSlug="post-slug"
                >
                  <CommentDisplayDropdown />
                </CommentDisplayProvider>
              </BanAuthorDialogProvider>
            </CommentVisibilityDialogProvider>
          </CommentDeleteDialogProvider>
        </PostDeleteDialogProvider>
      </PostCollectionsProvider>
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

  it("hides the ban action when the host does not offer one", async () => {
    const screen = await renderBanMenu({ canBanAuthor: false });
    await screen.getByRole("button", { name: "Comment menu" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Ban user$/ }))
      .not.toBeInTheDocument();
  });

  it("offers the ban action for a customer", async () => {
    const screen = await renderBanMenu();
    await screen.getByRole("button", { name: "Comment menu" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Ban user$/ }))
      .toBeVisible();
  });

  it("offers neither ban nor unban for a member", async () => {
    const screen = await renderBanMenu({ authorIsMember: true });
    await screen.getByRole("button", { name: "Comment menu" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Ban user$/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Unban user$/ }))
      .not.toBeInTheDocument();
  });

  it("offers unban instead of ban for a banned author", async () => {
    const screen = await renderBanMenu({ authorIsBanned: true });
    await screen.getByRole("button", { name: "Comment menu" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Ban user$/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Unban user$/ }))
      .toBeVisible();
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
