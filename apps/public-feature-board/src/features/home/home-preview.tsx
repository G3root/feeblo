import {
  POST_STATUS_TYPES,
  type TPostStatusType,
} from "@feeblo/domain/post-status/schema";
import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { PostCard } from "@feeblo/post-ui/post/post-card";
import { UpvoteToggle } from "@feeblo/post-ui/upvote-toggle";
import { Card, CardPanel } from "@feeblo/ui/card";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { LockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { PoweredByTag } from "../../components/layout/powered-by-tag";
import { m } from "../../paraglide/messages.js";
import {
  HomeLayout,
  HomeSidebar,
  HomeTitle,
  HomeToolbar,
  surfaceClassName,
} from "./home-chrome";
import {
  HomeContext,
  type HomeContextValue,
  type HomeFilterItem,
} from "./home-context";

/**
 * The public home page as the register page's preview.
 *
 * A list of requests is the shape of the product a new workspace opens on, and
 * the register preview has the room to show it: the feed carries three sample
 * posts (the ones `createWorkspace` seeds), the board names the reader is
 * typing, and the address being checked. The live chrome is reused rather than
 * redrawn — title, toolbar and filters are the home page's own components,
 * driven by a static context instead of a live query.
 *
 * The feed itself is composed from the shared `PostCard` primitives and the
 * real `UpvoteToggle`, with a static row instead of the live wrapper: a vote
 * on a workspace that does not exist yet would need a collection, a session
 * and a server, and a preview that invents numbers is worse than one that
 * shows the honest zero every seeded post carries.
 *
 * The row's meta follows the panel, not the window. A split panel is about half
 * the viewport, so the desktop meta column only fits from `xl` up; below that
 * the row uses the mobile meta the product already has. The filter sidebar
 * appears at `2xl`, where there is room for it without squeezing the feed.
 */

export type HomePreviewPost = {
  /** The board the sample post lands on, as its badge should read. */
  readonly boardName: string;
  /** The first paragraph of the seeded body, which the list row truncates. */
  readonly excerpt: string;
  readonly title: string;
};

export type HomePreviewProps = {
  /**
   * Who the sample posts are attributed to: the person creating the
   * workspace, because `createWorkspace` writes them as its author.
   */
  readonly authorName: string;
  /** The boards the reader kept, in the order they kept them. */
  readonly boardNames: readonly string[];
  /** The address being checked, drawn in the navbar. */
  readonly host: string;
  readonly logoUrl: string | null;
  readonly posts: readonly HomePreviewPost[];
  readonly workspaceName: string;
};

/** The labels `DEFAULT_POST_STATUSES` seeds, in the vocabulary's order. */
const statusLabels = {
  CLOSED: formatPostStatus("CLOSED"),
  COMPLETED: formatPostStatus("COMPLETED"),
  IN_PROGRESS: formatPostStatus("IN_PROGRESS"),
  PENDING: formatPostStatus("PENDING"),
  PLANNED: formatPostStatus("PLANNED"),
  REVIEW: formatPostStatus("REVIEW"),
} satisfies Record<TPostStatusType, string>;

/**
 * The seeded status's colour, matching `DEFAULT_POST_STATUS_COLORS.PENDING` in
 * `@feeblo/domain-contracts`.
 *
 * The board package does not depend on the contracts package, and a dot in the
 * wrong hue is a small lie about a colour the reader sees moments after
 * creating the workspace.
 */
const pendingStatusColor = "oklch(0.556 0 0)";

/** A noop action: the preview is a picture, not a page anyone can operate. */
const ignore = () => undefined;

function createPreviewHomeValue({
  boardNames,
  posts,
}: Pick<HomePreviewProps, "boardNames" | "posts">): HomeContextValue {
  const countByBoard = new Map(
    boardNames.map(
      (name) =>
        [name, posts.filter((post) => post.boardName === name).length] as const
    )
  );

  const statusItems: HomeFilterItem[] = [
    {
      count: posts.length,
      kind: "all",
      label: m.curly_many_badger(),
      value: "all",
    },
    ...POST_STATUS_TYPES.map((type) => ({
      count: type === "PENDING" ? posts.length : 0,
      icon: null,
      kind: "status" as const,
      label: statusLabels[type],
      statusType: type,
      value: type,
    })),
  ];

  const boardItems: HomeFilterItem[] = [
    {
      count: posts.length,
      kind: "all",
      label: m.spry_male_nils(),
      value: "all",
    },
    ...boardNames.map((name) => ({
      count: countByBoard.get(name) ?? 0,
      icon: null,
      kind: "board" as const,
      label: name,
      value: name,
    })),
  ];

  return {
    actions: {
      openGiveFeedback: ignore,
      setSearch: ignore,
      setSearchFocused: ignore,
      updateFilters: ignore,
    },
    meta: { organizationId: "" },
    state: {
      activeBoardId: "",
      activeBoardLabel: m.spry_male_nils(),
      boardItems,
      // The preview feed has its own static list; this value is only here so
      // the shared context has the shape the chrome expects.
      filteredPosts: [],
      isError: false,
      isLoading: false,
      normalizedSearch: "",
      search: "",
      searchFocused: false,
      selectedBoard: "all",
      selectedStatus: "all",
      sortBy: "newest",
      statusItems,
    },
  };
}

function NavTab({
  active,
  label,
}: {
  readonly active?: boolean;
  readonly label: string;
}) {
  return (
    <span
      className={cn(
        "relative flex items-center px-1.5 py-2 text-sm",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
      {active ? (
        <span className="bg-foreground/80 absolute inset-x-1 bottom-0 h-0.5 rounded-full" />
      ) : null}
    </span>
  );
}

/**
 * The board's header as an anonymous visitor sees it: whose board this is, its
 * tabs, and the address it lives at. The real navbar resolves a session, a
 * locale switcher and a notification menu; those are the visitor's state, not
 * the workspace's, so the preview omits them and keeps the address.
 */
function PreviewNavbar({
  host,
  logoUrl,
  name,
}: {
  readonly host: string;
  readonly logoUrl: string | null;
  readonly name: string;
}) {
  return (
    <header className="bg-background/80 shrink-0 border-b backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar image={logoUrl} name={name} />
              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                {name}
              </h1>
            </div>

            <nav className="text-muted-foreground hidden items-center gap-4 self-stretch text-sm xl:flex">
              <NavTab active label={m.caring_brave_orangutan()} />
              <NavTab label={m.slimy_stale_blackbird()} />
              <NavTab label={m.strong_loved_flamingo()} />
            </nav>
          </div>

          <span className="text-muted-foreground border-border/60 bg-muted/40 flex max-w-48 min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
            <HugeiconsIcon
              aria-hidden
              className="size-2.5 shrink-0 opacity-70"
              icon={LockIcon}
              strokeWidth={2}
            />
            <span className="truncate">{host}</span>
          </span>
        </div>

        <nav className="text-muted-foreground flex items-center gap-4 pb-2 text-sm xl:hidden">
          <NavTab active label={m.caring_brave_orangutan()} />
          <NavTab label={m.slimy_stale_blackbird()} />
          <NavTab label={m.strong_loved_flamingo()} />
        </nav>
      </div>
    </header>
  );
}

function PreviewPostRow({
  authorName,
  post,
}: {
  readonly authorName: string;
  readonly post: HomePreviewPost;
}) {
  return (
    <PostCard.Root className="[contain-intrinsic-size:auto_72px]">
      <PostCard.Media>
        <UpvoteToggle
          isUpvoted={false}
          onToggle={ignore}
          upvoteCount={0}
          variant="compact"
        />
      </PostCard.Media>

      <PostCard.Body>
        <PostCard.Title>{post.title}</PostCard.Title>
        <PostCard.Description>{post.excerpt}</PostCard.Description>

        {/* The mobile meta the board already has: below `xl` the panel is too
            narrow for the status/board/author column on the right. */}
        <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs xl:hidden">
          <UserAvatar
            className="size-5"
            image={null}
            isMember
            name={authorName}
            size="sm"
          />
          <span className="truncate">{authorName}</span>
          <span aria-hidden className="text-border">
            ·
          </span>
          <span className="truncate">{post.boardName}</span>
        </div>
      </PostCard.Body>

      <div className="relative z-10 hidden shrink-0 items-center xl:flex">
        <PostCard.DesktopMeta>
          <PostCard.Status
            color={pendingStatusColor}
            label={statusLabels.PENDING}
            type="PENDING"
          />
          <PostCard.BoardBadge icon={null}>
            {post.boardName}
          </PostCard.BoardBadge>
          <PostCard.Author isMember name={authorName} />
        </PostCard.DesktopMeta>
      </div>
    </PostCard.Root>
  );
}

function PreviewFeed({
  authorName,
  posts,
}: Pick<HomePreviewProps, "authorName" | "posts">) {
  return (
    <Card className={surfaceClassName("overflow-hidden")}>
      <CardPanel className="px-0 py-0">
        <div className="divide-border/40 divide-y">
          {posts.map((post) => (
            <PreviewPostRow
              authorName={authorName}
              key={post.title}
              post={post}
            />
          ))}
        </div>
      </CardPanel>
    </Card>
  );
}

export function HomePreview({
  authorName,
  boardNames,
  host,
  logoUrl,
  posts,
  workspaceName,
}: HomePreviewProps) {
  const value = createPreviewHomeValue({ boardNames, posts });

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PreviewNavbar host={host} logoUrl={logoUrl} name={workspaceName} />

      <main className="min-h-0 flex-1 overflow-hidden">
        <HomeContext value={value}>
          <HomeLayout>
            <div className="space-y-6">
              <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_160px] 2xl:gap-4">
                <div className="flex min-w-0 flex-col gap-4">
                  <HomeTitle />
                  <HomeToolbar />
                  <PreviewFeed authorName={authorName} posts={posts} />
                </div>

                <div className="hidden 2xl:block">
                  <HomeSidebar />
                </div>
              </div>
            </div>
          </HomeLayout>
        </HomeContext>
      </main>

      <PoweredByTag />
    </div>
  );
}
