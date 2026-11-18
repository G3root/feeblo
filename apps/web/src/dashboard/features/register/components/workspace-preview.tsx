import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";

import {
  ProductPostShot,
  type ProductShotPost,
} from "~/components/product-shot/product-post-shot";

import type { RegisterBoardDraft } from "../lib/register-draft";

/**
 * The workspace the reader is about to create, shown as the one screen the
 * product is for: a request, open.
 *
 * A preview is worth showing only if it is the truth about the fields beside
 * it. The address at the top is the subdomain the server is checking, the name
 * is the name being typed, the logo is the logo just uploaded, the board is the
 * first board they kept, and the post is the real sample post every workspace
 * opens with — body and all, from `packages/domain/src/workspace/onboarding.ts`.
 *
 * A whole board page would have to invent more than this one does: three posts
 * cannot fill a full-height panel, so a board view either floats in the middle
 * of it or pads the empty half with something the reader will never see. A post
 * with no comments is the honest state of a workspace created ten seconds from
 * now, and it leaves room for the composer, which is the half of the product a
 * new owner uses first.
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

/**
 * The welcome post `createWorkspace` seeds, as the board will show it.
 *
 * Kept in step with `onboarding.ts` by naming the same words, not by importing
 * the templates: the server's copy is the one that ships, and this is a picture
 * of it. All three sample posts arrive Pending, which is why the status is not
 * a variable here.
 */
const welcomePost: Omit<ProductShotPost, "board" | "author"> = {
  intro:
    "Your workspace is ready. It has boards, a public roadmap, a changelog and a help center. We added three sample posts so you can see how they fit together.",
  sections: [
    {
      heading: "What you can do here",
      points: [
        "Collect posts on the Bugs and Features boards",
        "Vote and comment so the most wanted work stays visible",
        "Move a post's status to put it on the roadmap",
        "Publish what shipped in the changelog",
      ],
    },
    {
      heading: "Suggested next steps",
      points: [
        "Open a sample post and change its status",
        "Write your own with New post",
        "Add your logo and colours in Settings",
      ],
    },
  ],
  status: {
    color: DEFAULT_POST_STATUS_COLORS.PENDING,
    label: "Pending",
  },
  title: "Welcome to your workspace",
  votes: 0,
};

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

  // A post belongs to one board, and the samples land on the first board the
  // reader kept, so that is the board the picture has to name.
  const board = boards.find(
    (draft) => draft.enabled && draft.name.trim().length > 0
  );

  return (
    <div className="bg-muted/40 relative h-full overflow-hidden dark:bg-black/30">
      <div className="bg-background border-border absolute top-8 right-0 bottom-0 left-8 flex flex-col overflow-hidden rounded-tl-2xl border-r-0 border-b-0 shadow-lg shadow-black/5">
        <ProductPostShot
          comments={[]}
          host={host}
          logoUrl={logoUrl}
          name={name}
          post={{
            ...welcomePost,
            author: authorName,
            board: board?.name.trim(),
          }}
        />
      </div>
    </div>
  );
}
