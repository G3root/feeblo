import type { TBoard } from "@feeblo/domain/board/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PostPage } from "./post-page";
import {
  createPostCollectionState,
  PostCollectionStateProvider,
} from "./post-page-context";

vi.mock("@feeblo/web-shared/use-auth-state", () => ({
  useAuthState: () => ({ data: null }),
}));
vi.mock("@feeblo/web-shared/use-policy", () => ({
  anyPolicy: vi.fn(),
  hasOwnerOrAdminRole: vi.fn(),
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

const board = { visibility: "PUBLIC" } as TBoard;

function state({
  authenticated = false,
  canManage = false,
  locked = false,
} = {}) {
  const post = {
    archivedAt: null,
    lockedAt: locked ? new Date() : null,
    mergedIntoPostId: null,
  } as TPost;

  return createPostCollectionState({
    board,
    canManagePost: canManage,
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
    </PostCollectionStateProvider>
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

  it("composes the post editor, reactions, votes, and discussion", async () => {
    const screen = await render(
      <PostCollectionStateProvider value={state()}>
        <PostPage.Title />
        <PostPage.Content />
        <PostPage.Reactions />
        <PostPage.CompactVote />
        <PostPage.PublicCommentComposer />
        <PostPage.Comments />
      </PostCollectionStateProvider>
    );

    await expect
      .element(screen.getByRole("heading", { name: "post title" }))
      .toBeVisible();
    await expect.element(screen.getByText("post content")).toBeVisible();
    await expect.element(screen.getByText("reaction picker")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "compact vote" }))
      .toBeVisible();
    await expect.element(screen.getByText("comment composer")).toBeVisible();
    await expect.element(screen.getByText("comments list")).toBeVisible();
  });
});
