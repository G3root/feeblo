import {
  HomePreview,
  type HomePreviewPost,
} from "@feeblo/public-feature-board/home-preview";
import { slugify } from "@feeblo/utils/url";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";

import type { RegisterBoardDraft } from "../lib/register-draft";

/**
 * The workspace the reader is about to create, shown as the page they will
 * land on: the board's home, with the three sample posts a new workspace opens
 * with.
 *
 * The home page is the honest picture, not a post page. A workspace created a
 * minute from now has three posts and no conversation, and the home page is the
 * one screen that shows what those three posts are for: a feed with boards and
 * statuses beside it. Its chrome and list are the public board's own
 * components (`HomePreview`), so the preview cannot drift into an
 * approximation of the page: the title, toolbar, filters and rows are the same
 * parts the board renders.
 *
 * The details are live where the reader can change them: the address in the
 * navbar is the subdomain the server is checking, the name and logo are the
 * ones being typed and uploaded, and the boards are the ones they kept. The
 * posts stay the seeds — inventing three more would make the preview lie about
 * a feed that does not exist yet.
 *
 * Rendered at its natural size rather than scaled down: the register form is a
 * narrow column on a wide screen, so the panel only has to look right at one
 * width, and type that stays at its real size reads as a product instead of a
 * screenshot.
 */

/** Where the address bar's subdomain ends and the shared root begins. */
const appRootDomain = () => getRuntimePublicEnv().appRootDomain ?? "";

const placeholderName = "Your workspace";

const placeholderSlug = "your-workspace";

/** The first board a create falls back to when the reader kept no named board. */
const placeholderBoard = "Features";

/**
 * The sample posts `createWorkspace` seeds, as the home feed will show them.
 *
 * Kept in step with `onboarding.ts` by naming the same words, not by importing
 * the templates: the server's copy is the one that ships, and this is a picture
 * of it. All three arrive Pending, on the board named by their slug, with the
 * first board the reader kept as the fallback — exactly the rule the seed uses.
 */
const samplePosts = [
  {
    boardSlug: "features",
    excerpt:
      "Your workspace is ready. It has boards, a public roadmap, a changelog and a help center. We added three sample posts so you can see how they fit together.",
    title: "Welcome to your workspace",
  },
  {
    boardSlug: "features",
    excerpt:
      "Use the Features board for product ideas, improvements, and requests.",
    title: "How ideas become roadmap items",
  },
  {
    boardSlug: "bugs",
    excerpt:
      "Use the Bugs board when something is broken or behaves unexpectedly.",
    title: "What makes a bug report useful",
  },
] as const;

/**
 * The boards a create will write: enabled, named, deduplicated by slug and in
 * the reader's order.
 *
 * `createWorkspace` drops a name that slugifies to one already kept, so the
 * preview has to drop it too; two "Features" rows in the sidebar would picture
 * a workspace the server will not create.
 */
function keptBoardNames(
  boards: readonly RegisterBoardDraft[]
): readonly string[] {
  const namedBoards = boards.flatMap((board) => {
    const name = board.name.trim();
    const slug = slugify(name);

    return board.enabled && name.length > 0 && slug.length > 0
      ? [{ name, slug }]
      : [];
  });

  // The first name wins, as it does in the create: a later board whose slug
  // matches one already kept is dropped rather than renamed.
  const names = namedBoards.flatMap(({ name, slug }, index) =>
    namedBoards.findIndex((board) => board.slug === slug) === index
      ? [name]
      : []
  );

  // The wizard refuses to leave the boards step without one, but the identity
  // step previews a draft that has not reached that validation yet.
  return names.length > 0 ? names : [placeholderBoard];
}

export function WorkspacePreview({
  authorName,
  boards,
  logoUrl,
  subdomain,
  workspaceName,
}: {
  /**
   * Who the sample posts are attributed to: the person creating the
   * workspace, because `createWorkspace` writes them as its author. Falling
   * back to the workspace's own name would turn an org into a person.
   */
  readonly authorName: string;
  readonly boards: readonly RegisterBoardDraft[];
  readonly logoUrl: string | null;
  readonly subdomain: string;
  readonly workspaceName: string;
}) {
  const name = workspaceName.trim() || placeholderName;
  const root = appRootDomain();
  const host = `${subdomain.trim() || placeholderSlug}${root ? `.${root}` : ""}`;

  const boardNames = keptBoardNames(boards);

  const boardBySlug = new Map(
    boardNames.map((boardName) => [slugify(boardName), boardName] as const)
  );

  const fallbackBoard = boardNames[0] ?? placeholderBoard;

  // A post belongs to one board, and the seed files each template under the
  // board its slug names, falling back to the first board the reader kept.
  const posts: HomePreviewPost[] = samplePosts.map((post) => ({
    boardName: boardBySlug.get(post.boardSlug) ?? fallbackBoard,
    excerpt: post.excerpt,
    title: post.title,
  }));

  return (
    // The preview is a picture of a workspace that does not exist yet, so it
    // is hidden from assistive technology and inert: a screen reader
    // announcing sample posts and a vote count for a fictional board would be
    // describing a page nobody can reach.
    <div
      aria-hidden
      className="bg-muted/40 relative h-full overflow-hidden dark:bg-black/30"
      inert
    >
      <div className="bg-background border-border absolute top-8 right-0 bottom-0 left-8 flex flex-col overflow-hidden rounded-tl-2xl border-r-0 border-b-0 shadow-lg shadow-black/5">
        <HomePreview
          authorName={authorName}
          boardNames={boardNames}
          host={host}
          logoUrl={logoUrl}
          posts={posts}
          workspaceName={name}
        />
      </div>
    </div>
  );
}
