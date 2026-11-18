import { currentDb, schema } from "@feeblo/db";
import { PostId, PostTagId, TagId } from "@feeblo/id";
import { slugify } from "@feeblo/utils/url";
import { and, eq } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

/**
 * The `post.metadata` key that marks a sample post.
 *
 * A seeded post is an ordinary post: ordinary board, ordinary status, ordinary
 * tags, deletable like any other. The marker is the only thing that says it
 * arrived with the workspace, so the dashboard can count the samples and a
 * reader can tell the difference between "we wrote this" and "a customer wrote
 * this".
 *
 * `post.metadata` is a flat `Record<string, string>` column, so provenance is
 * one key whose value is the template that produced the row rather than a
 * nested `{ customFields: { … } }` object.
 */
export const onboardingPostKindKey = "onboarding";

export type OnboardingPostKind = "welcome" | "ideas" | "bugs";

type OnboardingPostTemplate = {
  /**
   * The board this sample belongs on, by slug. Both boards are written by
   * `createWorkspace` before this runs, so the slug is the join key rather
   * than an id this module would have to be told.
   */
  readonly boardSlug: string;
  readonly content: string;
  readonly kind: OnboardingPostKind;
  readonly title: string;
};

/**
 * The tag the sample posts wear.
 *
 * One tag, not a taxonomy: three posts are not enough to demonstrate a
 * category system, and a workspace that deletes the samples can delete the tag
 * with them.
 */
const sampleTag = { name: "Guide", slug: "guide" } as const;

/**
 * What a new workspace opens with.
 *
 * Three posts of deliberately different kinds, because a single sample can
 * only show one shape of thing. The welcome post is an orientation and says so
 * in its own body; the other two are examples of the two kinds of feedback a
 * board collects, written so that editing one is easier than writing one from
 * scratch.
 *
 * Titles become slugs (`post.slug` is unique per workspace), so they have to
 * be distinct. They are, and would stay distinct under a rename of any single
 * template.
 */
const onboardingPosts: readonly OnboardingPostTemplate[] = [
  {
    boardSlug: "features",
    kind: "welcome",
    title: "Welcome to your workspace",
    content: [
      "Your workspace is ready. It has boards, a public roadmap, a changelog and a help center. We added three sample posts so you can see how they fit together.",
      "## What you can do here",
      "- Collect posts on the Bugs and Features boards\n- Vote and comment so the most wanted work stays visible\n- Move a post's status to put it on the roadmap\n- Publish what shipped in the changelog",
      "## Suggested next steps",
      "- Open a sample post and change its status\n- Write your own with **New post**\n- Add your logo and colours in Settings",
    ].join("\n\n"),
  },
  {
    boardSlug: "features",
    kind: "ideas",
    title: "How ideas become roadmap items",
    content: [
      "Use the Features board for product ideas, improvements, and requests.",
      "## Write a post worth reading",
      "- Lead with the outcome you want, not the implementation\n- Explain the problem in a couple of sentences\n- Add a tag when the idea belongs to a theme",
      "## The status decides where it lands",
      "- Set the status to Planned and the post appears in that roadmap column\n- In progress and Completed work the same way\n- Nothing else has to be updated",
    ].join("\n\n"),
  },
  {
    boardSlug: "bugs",
    kind: "bugs",
    title: "What makes a bug report useful",
    content: [
      "Use the Bugs board when something is broken or behaves unexpectedly.",
      "## A report someone can act on",
      "- What you were trying to do\n- The steps that reproduce it\n- What you expected, and what happened instead\n- Browser, device, or version when it matters",
      "## While it is open",
      "- Upvotes show how widely the bug is felt\n- The assignee is who owns the fix\n- A comment or a status change tells the reporter someone is looking",
    ].join("\n\n"),
  },
];

/** A post needs an excerpt for the list rows; the seeded body is plain enough to derive one. */
const toExcerpt = (content: string): string => {
  const firstParagraph = content.split("\n\n")[0] ?? "";

  const plain = firstParagraph
    // Only the markers that can start a block, and bold marks inside one.
    // Internal hyphens are part of the words they join, so they stay.
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .trim();

  return plain.length > 200 ? `${plain.slice(0, 197).trimEnd()}...` : plain;
};

export type SeedWorkspaceOnboardingArgs = {
  /**
   * The boards the workspace was created with, in the reader's order.
   *
   * A template names the board it belongs on by slug, and a workspace whose
   * boards the reader named themselves has none of those slugs. Rather than
   * dropping the samples, the first board the reader picked takes them, which
   * is the one they are most likely to open.
   */
  readonly boardIds: readonly string[];
  /** The owner membership the sample posts are attributed to. */
  readonly memberId: string;
  readonly organizationId: string;
  readonly userId: string;
};

/**
 * The tag the sample posts wear, created only if the workspace does not
 * already have it.
 *
 * A workspace is created with its priority tags but not this one, so the
 * lookup is a guard against a future default-tag list that happens to include
 * it. Two tags with the same slug would make the post links ambiguous.
 */
const ensureSampleTag = Effect.fn("seedWorkspaceOnboarding.ensureSampleTag")(
  function* (args: {
    readonly memberId: string;
    readonly now: Date;
    readonly organizationId: string;
    readonly userId: string;
  }) {
    const db = yield* currentDb;

    const [existing] = yield* db
      .select({ id: schema.tagTable.id })
      .from(schema.tagTable)
      .where(
        and(
          eq(schema.tagTable.organizationId, args.organizationId),
          eq(schema.tagTable.slug, sampleTag.slug)
        )
      )
      .limit(1);

    if (existing !== undefined) {
      return existing.id;
    }

    const tagId = yield* TagId.generate;
    yield* db.insert(schema.tagTable).values({
      id: tagId,
      name: sampleTag.name,
      slug: sampleTag.slug,
      organizationId: args.organizationId,
      creatorId: args.userId,
      creatorMemberId: args.memberId,
      createdAt: args.now,
      updatedAt: args.now,
    });

    return tagId;
  }
);

/** One insert per sample post, plus its tag link, in the caller's transaction. */
const insertSamplePosts = Effect.fn(
  "seedWorkspaceOnboarding.insertSamplePosts"
)(function* (args: {
  readonly memberId: string;
  readonly now: Date;
  readonly organizationId: string;
  readonly statusId: string;
  readonly tagId: string;
  readonly templates: ReadonlyArray<{
    readonly boardId: string;
    readonly template: OnboardingPostTemplate;
  }>;
  readonly userId: string;
}) {
  const db = yield* currentDb;

  for (const { boardId, template } of args.templates) {
    const postId = yield* PostId.generate;

    yield* db.insert(schema.postTable).values({
      id: postId,
      organizationId: args.organizationId,
      boardId,
      statusId: args.statusId,
      title: template.title,
      slug: slugify(template.title),
      content: template.content,
      excerpt: toExcerpt(template.content),
      creatorId: args.userId,
      creatorMemberId: args.memberId,
      source: "DASHBOARD",
      metadata: { [onboardingPostKindKey]: template.kind },
      createdAt: args.now,
      updatedAt: args.now,
    });

    yield* db.insert(schema.postTagTable).values({
      id: yield* PostTagId.generate,
      postId,
      tagId: args.tagId,
      organizationId: args.organizationId,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
});

/**
 * Writes the sample posts a new workspace opens with.
 *
 * Runs inside `createWorkspace`'s transaction and reads through `currentDb`,
 * so every insert here joins that transaction through the fiber-local
 * connection and no transaction handle has to be threaded through. The caller
 * wraps this in a savepoint: sample data is a courtesy, and a workspace that
 * fails to be created because a template did not insert would be a worse bug
 * than a workspace with no samples.
 *
 * A template names its board by slug and falls back to the first board the
 * reader picked, so the samples land on a board that exists whatever the
 * workspace's boards are called. With no boards at all the seed writes
 * nothing, which is the one case where there is nowhere to put a post.
 */
export const seedWorkspaceOnboarding = (args: SeedWorkspaceOnboardingArgs) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const now = yield* DateTime.nowAsDate;

    const boards = yield* db
      .select({ id: schema.boardTable.id, slug: schema.boardTable.slug })
      .from(schema.boardTable)
      .where(eq(schema.boardTable.organizationId, args.organizationId));

    const boardIdBySlug = new Map(
      boards.map((board) => [board.slug, board.id] as const)
    );

    // Paired up front so the insert has the id rather than a lookup that could
    // miss: a template whose board is absent is dropped here, not filed under
    // an empty id and rolled back by the savepoint.
    const templates = onboardingPosts.flatMap((template) => {
      const boardId = boardIdBySlug.get(template.boardSlug) ?? args.boardIds[0];

      return boardId === undefined ? [] : [{ boardId, template }];
    });

    if (templates.length === 0) {
      return;
    }

    const [defaultStatus] = yield* db
      .select({ id: schema.postStatusTable.id })
      .from(schema.postStatusTable)
      .where(
        and(
          eq(schema.postStatusTable.organizationId, args.organizationId),
          eq(schema.postStatusTable.isDefault, true)
        )
      )
      .limit(1);

    // A workspace with no default status has nothing to file a post under.
    if (defaultStatus === undefined) {
      return;
    }

    const tagId = yield* ensureSampleTag({ ...args, now });

    yield* insertSamplePosts({
      ...args,
      now,
      statusId: defaultStatus.id,
      tagId,
      templates,
    });
  });
