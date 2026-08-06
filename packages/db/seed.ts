// biome-ignore-all lint/suspicious/noConsole: Seed script requires console output
import { faker } from "@faker-js/faker";
import { initAuthHandler } from "@feeblo/auth/server";
import {
  BoardId,
  ChangelogCategoryId,
  ChangelogId,
  ChangelogTagId,
  CommentId,
  CommentReactionId,
  MemberId,
  PostId,
  PostReactionId,
  PostStatusId,
  RoadmapColumnId,
  RoadmapId,
  SiteId,
  SubscriptionId,
  TagId,
  UpvoteId,
  WorkspaceId,
} from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { and, eq, inArray } from "drizzle-orm";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "./src";
import { nukeDatabase } from "./src/nuke";
import {
  boardTable,
  changelogCategoryTable,
  changelogPostTable,
  changelogTable,
  changelogTagTable,
  commentReactionTable,
  commentTable,
  DEFAULT_CHANGELOG_CATEGORIES,
  DEFAULT_POST_STATUSES,
  memberTable,
  organizationTable,
  postReactionTable,
  postStatusTable,
  postTable,
  productTable,
  roadmapColumnTable,
  roadmapTable,
  siteTable,
  subscriptionTable,
  tagTable,
  upvoteTable,
  userTable,
} from "./src/schema";

const TEST_USER = {
  email: "test@feeblo.dev",
  password: "TestPassword123!",
  name: "Test User",
};

const TEAM_USERS = [
  {
    email: "alex@feeblo.dev",
    name: "Alex",
    joinMainOrg: true,
    mainOrgRole: "manager",
  },
  {
    email: "sam@feeblo.dev",
    name: "Sam",
    joinMainOrg: true,
    mainOrgRole: "manager",
  },
  {
    email: "jordan@feeblo.dev",
    name: "Jordan",
    joinMainOrg: true,
    mainOrgRole: "contributor",
  },
  {
    email: "morgan@feeblo.dev",
    name: "Morgan",
    joinMainOrg: false,
    mainOrgRole: null,
  },
  {
    email: "taylor@feeblo.dev",
    name: "Taylor",
    joinMainOrg: false,
    mainOrgRole: null,
  },
] as const;

const MAIN_POST_COUNT = 40;
const EXTERNAL_POST_COUNT = 12;

const REACTIONS = [
  "thumbs_up",
  "thumbs_down",
  "grinning_face_with_smiling_eyes",
  "party_popper",
  "fire",
  "eyes",
  "red_heart",
  "rocket",
] as const;

type SeedPlan = "starter" | "professional";
type SeedVariant = "monthly" | "yearly";

/**
 * A subscription lifecycle scenario for a seeded organization. Organizations
 * without a scenario stay on the free plan (no subscription row).
 */
type SubscriptionScenario = {
  productPlan: SeedPlan;
  productVariant: SeedVariant;
  status: NonNullable<typeof subscriptionTable.$inferInsert.status>;
  /** Amount in cents, matching Polar payloads. */
  amount: number;
  interval: "month" | "year";
  cancelAtPeriodEnd?: boolean;
};

const makeProductId = (plan: SeedPlan, variant: SeedVariant) =>
  `prod_${plan}_${variant}`;

const SEED_PRODUCTS = [
  {
    name: "Starter",
    description: "For solo builders and small teams.",
    plan: "starter",
    variant: "monthly",
    interval: "month",
    amount: 1900,
  },
  {
    name: "Starter (Yearly)",
    description: "For solo builders and small teams, billed yearly.",
    plan: "starter",
    variant: "yearly",
    interval: "year",
    amount: 19_000,
  },
  {
    name: "Professional",
    description: "For teams running production workflows.",
    plan: "professional",
    variant: "monthly",
    interval: "month",
    amount: 4900,
  },
  {
    name: "Professional (Yearly)",
    description: "For teams running production workflows, billed yearly.",
    plan: "professional",
    variant: "yearly",
    interval: "year",
    amount: 49_000,
  },
] as const satisfies ReadonlyArray<{
  name: string;
  description: string;
  plan: SeedPlan;
  variant: SeedVariant;
  interval: "month" | "year";
  amount: number;
}>;

/**
 * Which subscription lifecycle each seeded organization should demo,
 * keyed by the owning user's email. Covers active, trialing, past_due,
 * and canceled — orgs not listed here are free.
 */
const ORGANIZATION_PLANS: Record<string, SubscriptionScenario> = {
  "test@feeblo.dev": {
    productPlan: "professional",
    productVariant: "yearly",
    status: "active",
    amount: 49_000,
    interval: "year",
  },
  "morgan@feeblo.dev": {
    productPlan: "starter",
    productVariant: "monthly",
    status: "trialing",
    amount: 1900,
    interval: "month",
  },
  "taylor@feeblo.dev": {
    productPlan: "professional",
    productVariant: "monthly",
    status: "past_due",
    amount: 4900,
    interval: "month",
  },
  "jordan@feeblo.dev": {
    productPlan: "starter",
    productVariant: "yearly",
    status: "canceled",
    amount: 19_000,
    interval: "year",
    cancelAtPeriodEnd: true,
  },
};

const CHANGELOG_TAG_NAMES = [
  "New features",
  "Improvements",
  "Bug fixes",
] as const;

const CHANGELOG_SEEDS = [
  {
    title: "Introducing the unified inbox",
    status: "published",
    publishedDaysAgo: 30,
    scheduledDaysAhead: null,
    tags: ["New features"],
    linkPostCount: 2,
    content: `We've redesigned how feedback lands in your workspace. Every submission now arrives in a single, triage-ready inbox, so nothing gets lost between boards, sites, and the API.

What's new
- A unified view across all boards and entry points
- Smarter duplicate detection with merge suggestions
- Keyboard-first triage with bulk actions

This is the first step toward a fully automated intake pipeline, and we'd love to hear how it feels for your team.`,
  },
  {
    title: "Faster triage with AI-powered summaries",
    status: "published",
    publishedDaysAgo: 12,
    scheduledDaysAhead: null,
    tags: ["Improvements", "New features"],
    linkPostCount: 2,
    content: `Your daily digest just got smarter. We now summarize overnight feedback with AI, so you wake up to a shortlist of the most impactful requests instead of a wall of notifications.

Highlights
- Nightly summaries grouped by theme and board
- Confidence scores on suggested status changes
- One-click promotion of summary items to the roadmap

Summaries respect your existing statuses and can be turned off per board in settings.`,
  },
  {
    title: "New integrations: Slack and Linear",
    status: "published",
    publishedDaysAgo: 4,
    scheduledDaysAhead: null,
    tags: ["New features"],
    linkPostCount: 1,
    content: `Feeblo now pushes updates to Slack and Linear, so your team can act on feedback without leaving the tools they already live in.

Set up in minutes
- Connect Slack to post status changes to any channel
- Mirror high-signal requests into Linear as issues
- Choose which boards and statuses sync in both directions`,
  },
  {
    title: "Webhooks are coming",
    status: "scheduled",
    publishedDaysAgo: null,
    scheduledDaysAhead: 5,
    tags: ["New features"],
    linkPostCount: 0,
    content: `Next week we're shipping outbound webhooks. Subscribe to post and comment events, receive them as signed JSON payloads, and build your own automations on top of Feeblo.

Event types
- post.created and post.status_changed
- comment.created
- Payloads signed with HMAC-SHA256

Sign up in the integrations tab to get early access.`,
  },
  {
    title: "Custom status workflows",
    status: "draft",
    publishedDaysAgo: null,
    scheduledDaysAhead: null,
    tags: ["Improvements"],
    linkPostCount: 0,
    content: `Explore a new way to model your pipeline. Custom statuses let you define exactly how feedback moves from submission to shipped, with rules for auto-advancing items and notifying the right people.

Planned capabilities
- Fully configurable status names and colors
- Automation rules on status transitions
- Per-board default entry status`,
  },
  {
    title: "Roadmap gets drag-and-drop planning",
    status: "published",
    publishedDaysAgo: 45,
    scheduledDaysAhead: null,
    tags: ["Improvements"],
    linkPostCount: 2,
    content: `Planning a quarter used to mean copying rows between spreadsheets. The roadmap is now fully interactive: drag posts between columns, reorder them within a status, and watch the timeline update live.

What changed
- Drag-and-drop between any roadmap columns
- Inline editing of titles and statuses
- Saved views that sync across your team`,
  },
  {
    title: "Faster boards: instant load times",
    status: "published",
    publishedDaysAgo: 60,
    scheduledDaysAhead: null,
    tags: ["Improvements"],
    linkPostCount: 1,
    content: `We've been hard at work on performance. Boards with thousands of posts now load in under a second, pagination is smoother, and the search index updates in real time.

Measured improvements
- 4x faster initial board load
- 60% reduction in memory usage on large workspaces
- Instant filtering, sorting, and search`,
  },
  {
    title: "Bug fixes and stability pass",
    status: "published",
    publishedDaysAgo: 2,
    scheduledDaysAhead: null,
    tags: ["Bug fixes"],
    linkPostCount: 1,
    content: `A round of fixes focused on reliability and edge cases reported by the community.

Fixed in this release
- Emoji reactions no longer double-count when reconnecting
- Comment notifications respect internal visibility settings
- The widget no longer flashes a loading state on slow connections
- Roadmap columns keep their order after a status rename`,
  },
  {
    title: "Export feedback to CSV",
    status: "scheduled",
    publishedDaysAgo: null,
    scheduledDaysAhead: 10,
    tags: ["New features"],
    linkPostCount: 0,
    content: `Coming soon: export any board, filtered view, or the full workspace to CSV. Perfect for quarterly reviews, importing into your analytics stack, or sharing with stakeholders who live in spreadsheets.

What you'll be able to do
- Export posts, comments, and status history
- Choose the columns that matter to you
- Schedule recurring exports to email`,
  },
  {
    title: "Team roles and permissions",
    status: "draft",
    publishedDaysAgo: null,
    scheduledDaysAhead: null,
    tags: ["New features", "Improvements"],
    linkPostCount: 0,
    content: `Draft: more granular roles are on the way. Beyond owners and members, we're introducing admins, moderators, and read-only analysts so every workspace can control who can edit, publish, and manage settings.

Planned roles
- Admin: full workspace control
- Moderator: triage and respond to feedback
- Analyst: read-only access with export permissions`,
  },
] as const satisfies ReadonlyArray<{
  title: string;
  status: "draft" | "scheduled" | "published";
  publishedDaysAgo: number | null;
  scheduledDaysAhead: number | null;
  tags: readonly string[];
  linkPostCount: number;
  content: string;
}>;

class SeedDataError extends Data.TaggedError("SeedDataError")<{
  readonly message: string;
}> {}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const formatPlan = (scenario: SubscriptionScenario | undefined) =>
  scenario ? `${scenario.productPlan} · ${scenario.status}` : "free";

const ensureUser = ({
  email,
  name,
  password,
}: {
  email: string;
  name: string;
  password: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const auth = yield* initAuthHandler();

    let [existingUser] = yield* db
      .select({
        id: userTable.id,
        email: userTable.email,
        emailVerified: userTable.emailVerified,
      })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);

    if (!existingUser) {
      const result = yield* Effect.tryPromise(() =>
        auth.api.signUpEmail({
          body: {
            email,
            password,
            name,
          },
        })
      );

      if (
        !result ||
        typeof result !== "object" ||
        !("user" in result) ||
        !result.user
      ) {
        return yield* new SeedDataError({
          message: `Failed to create user ${email}`,
        });
      }

      [existingUser] = yield* db
        .select({
          id: userTable.id,
          email: userTable.email,
          emailVerified: userTable.emailVerified,
        })
        .from(userTable)
        .where(eq(userTable.email, email))
        .limit(1);
    }

    if (!existingUser) {
      return yield* new SeedDataError({
        message: `User ${email} not found after creation`,
      });
    }

    if (!existingUser.emailVerified) {
      yield* db
        .update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.id, existingUser.id));
    }

    return existingUser;
  });

const ensureOrganization = (userId: string, name = "Personal") =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    let [org] = yield* db
      .select({
        id: organizationTable.id,
        name: organizationTable.name,
        slug: organizationTable.slug,
      })
      .from(organizationTable)
      .where(eq(organizationTable.slug, userId))
      .limit(1);

    if (!org) {
      const orgId = yield* WorkspaceId.generate;
      [org] = yield* db
        .insert(organizationTable)
        .values({
          id: orgId,
          name,
          slug: userId,
          createdAt: new Date(),
        })
        .returning({
          id: organizationTable.id,
          name: organizationTable.name,
          slug: organizationTable.slug,
        });
    }

    if (!org) {
      return yield* new SeedDataError({
        message: `Failed to ensure organization for ${userId}`,
      });
    }

    const [existingOwnerMembership] = yield* db
      .select({ id: memberTable.id })
      .from(memberTable)
      .where(
        and(
          eq(memberTable.organizationId, org.id),
          eq(memberTable.userId, userId)
        )
      )
      .limit(1);

    if (!existingOwnerMembership) {
      const memberId = yield* MemberId.generate;
      yield* db.insert(memberTable).values({
        id: memberId,
        organizationId: org.id,
        userId,
        role: "owner",
        createdAt: new Date(),
      });
    }

    const existingPostStatuses = yield* db
      .select({ id: postStatusTable.id })
      .from(postStatusTable)
      .where(eq(postStatusTable.organizationId, org.id))
      .limit(1);

    if (existingPostStatuses.length === 0) {
      for (const postStatusDefinition of DEFAULT_POST_STATUSES) {
        const postStatusId = yield* PostStatusId.generate;
        yield* db.insert(postStatusTable).values({
          id: postStatusId,
          organizationId: org.id,
          type: postStatusDefinition.type,
          orderIndex: postStatusDefinition.orderIndex,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    const existingChangelogCategories = yield* db
      .select({ id: changelogCategoryTable.id })
      .from(changelogCategoryTable)
      .where(eq(changelogCategoryTable.organizationId, org.id))
      .limit(1);

    if (existingChangelogCategories.length === 0) {
      for (const category of DEFAULT_CHANGELOG_CATEGORIES) {
        const categoryId = yield* ChangelogCategoryId.generate;
        yield* db.insert(changelogCategoryTable).values({
          id: categoryId,
          organizationId: org.id,
          name: category.name,
          iconType: category.iconType,
          icon: category.icon,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    const [primaryRoadmap] = yield* db
      .select({ id: roadmapTable.id })
      .from(roadmapTable)
      .where(
        and(
          eq(roadmapTable.organizationId, org.id),
          eq(roadmapTable.isPrimary, true)
        )
      )
      .limit(1);

    if (!primaryRoadmap) {
      const roadmapId = yield* RoadmapId.generate;
      const now = new Date();
      yield* db.insert(roadmapTable).values({
        id: roadmapId,
        organizationId: org.id,
        name: "Roadmap",
        slug: "roadmap",
        description: null,
        isPrimary: true,
        mode: "status",
        visibility: "public",
        filter: { version: 1, operator: "and", conditions: [] },
        createdAt: now,
        updatedAt: now,
      });

      const roadmapStatuses = yield* db
        .select({ id: postStatusTable.id, type: postStatusTable.type })
        .from(postStatusTable)
        .where(eq(postStatusTable.organizationId, org.id));
      const statusByType = new Map(
        roadmapStatuses.map((status) => [status.type, status.id])
      );

      for (const [position, type] of (
        ["PLANNED", "IN_PROGRESS", "COMPLETED"] as const
      ).entries()) {
        const statusId = statusByType.get(type);
        if (!statusId) {
          continue;
        }
        const columnId = yield* RoadmapColumnId.generate;
        yield* db.insert(roadmapColumnTable).values({
          id: columnId,
          roadmapId,
          name:
            type === "IN_PROGRESS"
              ? "In progress"
              : `${type[0]}${type.slice(1).toLowerCase()}`,
          position,
          config: { type: "status", statusId },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return org;
  });

const ensureSite = ({
  organizationId,
  name,
  subdomain,
}: {
  organizationId: string;
  name: string;
  subdomain: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    let [existing] = yield* db
      .select({ id: siteTable.id, subdomain: siteTable.subdomain })
      .from(siteTable)
      .where(eq(siteTable.organizationId, organizationId))
      .limit(1);

    if (!existing) {
      const siteId = yield* SiteId.generate;
      [existing] = yield* db
        .insert(siteTable)
        .values({
          id: siteId,
          name,
          subdomain,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: siteTable.id, subdomain: siteTable.subdomain });
    }

    if (!existing) {
      return yield* new SeedDataError({
        message: `Failed to ensure site for organization ${organizationId}`,
      });
    }

    return existing;
  });

const ensureMember = ({
  organizationId,
  userId,
  role,
}: {
  organizationId: string;
  userId: string;
  role: NonNullable<typeof memberTable.$inferInsert.role>;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    let [existing] = yield* db
      .select({ id: memberTable.id, role: memberTable.role })
      .from(memberTable)
      .where(
        and(
          eq(memberTable.organizationId, organizationId),
          eq(memberTable.userId, userId)
        )
      )
      .limit(1);

    if (!existing) {
      const memberId = yield* MemberId.generate;
      [existing] = yield* db
        .insert(memberTable)
        .values({
          id: memberId,
          organizationId,
          userId,
          role,
          createdAt: new Date(),
        })
        .returning({ id: memberTable.id, role: memberTable.role });
    }

    return existing;
  });

const ensureBoards = ({
  organizationId,
  names,
}: {
  organizationId: string;
  names: string[];
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    let boards = yield* db
      .select({ id: boardTable.id, name: boardTable.name })
      .from(boardTable)
      .where(eq(boardTable.organizationId, organizationId));

    if (boards.length === 0) {
      for (const name of names) {
        const boardId = yield* BoardId.generate;
        yield* db.insert(boardTable).values({
          id: boardId,
          name,
          slug: slugify(name),
          visibility: "PUBLIC",
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      boards = yield* db
        .select({ id: boardTable.id, name: boardTable.name })
        .from(boardTable)
        .where(eq(boardTable.organizationId, organizationId));
    }

    return boards;
  });

const ensureProducts = () =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const products: Array<{
      id: string;
      plan: SeedPlan;
      variant: SeedVariant;
    }> = [];

    for (const definition of SEED_PRODUCTS) {
      const id = makeProductId(definition.plan, definition.variant);

      const [existing] = yield* db
        .select({ id: productTable.id })
        .from(productTable)
        .where(eq(productTable.id, id))
        .limit(1);

      if (!existing) {
        yield* db.insert(productTable).values({
          id,
          name: definition.name,
          description: definition.description,
          trialInterval: "month",
          trialIntervalCount: 1,
          recurringInterval: definition.interval,
          recurringIntervalCount: 1,
          isRecurring: true,
          isArchived: false,
          externalOrganizationId: "org_polar_seed",
          visibility: "public",
          prices: [{ priceAmount: definition.amount, priceCurrency: "usd" }],
          metadata: {
            plan: definition.plan,
            variant: definition.variant,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      products.push({ id, plan: definition.plan, variant: definition.variant });
    }

    return products;
  });

const ensureSubscription = ({
  organizationId,
  products,
  scenario,
}: {
  organizationId: string;
  products: Array<{ id: string; plan: SeedPlan; variant: SeedVariant }>;
  scenario: SubscriptionScenario;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    const [existing] = yield* db
      .select({ id: subscriptionTable.id })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.organizationId, organizationId))
      .limit(1);

    if (existing) {
      return existing;
    }

    const product = products.find(
      (item) =>
        item.plan === scenario.productPlan &&
        item.variant === scenario.productVariant
    );

    if (!product) {
      return yield* new SeedDataError({
        message: `No seeded product found for ${scenario.productPlan}/${scenario.productVariant}`,
      });
    }

    const now = new Date();
    const isTrialing = scenario.status === "trialing";
    const isCanceled = scenario.status === "canceled";
    const trialStart = isTrialing ? addDays(now, -9) : null;
    const trialEnd = isTrialing ? addDays(now, 5) : null;
    const currentPeriodStart = isTrialing
      ? addDays(now, -9)
      : addDays(now, -35);
    // past_due keeps an open period so the plan still resolves while the
    // dashboard shows the payment-failed state.
    const currentPeriodEnd =
      scenario.status === "past_due"
        ? addDays(now, 5)
        : addDays(now, isTrialing ? 21 : 330);

    const subscriptionId = yield* SubscriptionId.generate;

    const [created] = yield* db
      .insert(subscriptionTable)
      .values({
        id: subscriptionId,
        externalId: `sub_seed_${organizationId}`,
        organizationId,
        amount: scenario.amount,
        cancelAtPeriodEnd: scenario.cancelAtPeriodEnd ?? false,
        currency: "usd",
        recurringInterval: scenario.interval,
        recurringIntervalCount: 1,
        status: scenario.status,
        currentPeriodStart,
        currentPeriodEnd,
        trialStart,
        trialEnd,
        canceledAt: isCanceled ? addDays(now, -10) : null,
        startedAt: currentPeriodStart,
        endsAt: isCanceled ? addDays(now, 330) : null,
        endedAt: null,
        customerId: `cus_seed_${organizationId}`,
        productId: product.id,
        discountId: null,
        checkoutId: `checkout_seed_${organizationId}`,
        seats: scenario.productPlan === "professional" ? 10 : 3,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: subscriptionTable.id });

    if (!created) {
      return yield* new SeedDataError({
        message: `Failed to create subscription for ${organizationId}`,
      });
    }

    return created;
  });

const ensurePosts = ({
  organizationId,
  boardIds,
  count,
  creatorId,
  creatorMemberId,
}: {
  organizationId: string;
  boardIds: string[];
  count: number;
  creatorId?: string;
  creatorMemberId?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;
    const now = new Date();
    const postStatuses = yield* db
      .select({ id: postStatusTable.id, type: postStatusTable.type })
      .from(postStatusTable)
      .where(eq(postStatusTable.organizationId, organizationId));

    const [existing] = yield* db
      .select({ id: postTable.id })
      .from(postTable)
      .where(eq(postTable.organizationId, organizationId))
      .limit(1);

    if (!existing) {
      for (let i = 0; i < count; i++) {
        const boardId = boardIds[i % boardIds.length] ?? boardIds[0];

        if (!boardId) {
          return yield* new SeedDataError({
            message: "No board found to seed posts",
          });
        }

        const randomPostStatus =
          faker.helpers.arrayElement(postStatuses) ??
          postStatuses.find((status) => status.type === "PLANNED");

        if (!randomPostStatus) {
          return yield* new SeedDataError({
            message: "No post status found to seed posts",
          });
        }

        const title = faker.company.catchPhrase();
        const content = faker.lorem.paragraphs({ min: 2, max: 4 });
        const lockedAt = i % 13 === 0 ? now : null;

        const postId = yield* PostId.generate;
        yield* db.insert(postTable).values({
          id: postId,
          title,
          slug: slugify(`${title}-${i + 1}`),
          content,
          excerpt: htmlToExcerpt(content),
          boardId,
          statusId: randomPostStatus.id,
          organizationId,
          creatorId: creatorId ?? null,
          creatorMemberId: creatorMemberId ?? null,
          lockedAt,
          archivedAt: null,
          mergedIntoPostId: null,
          mergedAt: null,
          createdAt: faker.date.recent({ days: 120, refDate: now }),
          updatedAt: now,
        });
      }
    }

    return yield* db
      .select({ id: postTable.id, title: postTable.title })
      .from(postTable)
      .where(eq(postTable.organizationId, organizationId));
  });

const seedEngagement = ({
  organizationId,
  actorIds,
  posts,
}: {
  organizationId: string;
  actorIds: string[];
  posts: Array<{ id: string; title: string }>;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    if (actorIds.length === 0 || posts.length === 0) {
      return;
    }

    const membershipRows =
      actorIds.length > 0
        ? yield* db
            .select({ userId: memberTable.userId, memberId: memberTable.id })
            .from(memberTable)
            .where(
              and(
                eq(memberTable.organizationId, organizationId),
                inArray(memberTable.userId, actorIds)
              )
            )
        : [];

    const memberIdByUserId = new Map(
      membershipRows.map((item) => [item.userId, item.memberId])
    );

    const [existingComment] = yield* db
      .select({ id: commentTable.id })
      .from(commentTable)
      .where(eq(commentTable.organizationId, organizationId))
      .limit(1);

    if (existingComment) {
      console.log(
        "   Engagement already exists, skipping comments/likes/reactions"
      );
      return;
    }

    const targetPosts = posts.slice(0, 12);
    const createdComments: Array<{ id: string; userId: string }> = [];

    for (const [index, postItem] of targetPosts.entries()) {
      const commentCount = faker.number.int({
        min: 1,
        max: Math.min(3, actorIds.length),
      });

      for (let i = 0; i < commentCount; i++) {
        const actorId = actorIds[(index + i) % actorIds.length];

        if (!actorId) {
          continue;
        }

        const commentId = yield* CommentId.generate;

        yield* db.insert(commentTable).values({
          id: commentId,
          content: faker.lorem.sentences({ min: 1, max: 3 }),
          organizationId,
          postId: postItem.id,
          userId: actorId,
          memberId: memberIdByUserId.get(actorId) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        createdComments.push({ id: commentId, userId: actorId });
      }

      const upvoters = faker.helpers.arrayElements(
        actorIds,
        faker.number.int({ min: 1, max: Math.min(4, actorIds.length) })
      );

      for (const upvoterId of upvoters) {
        const [existing] = yield* db
          .select({ id: upvoteTable.id })
          .from(upvoteTable)
          .where(
            and(
              eq(upvoteTable.userId, upvoterId),
              eq(upvoteTable.postId, postItem.id)
            )
          )
          .limit(1);

        if (!existing) {
          const upvoteId = yield* UpvoteId.generate;
          yield* db.insert(upvoteTable).values({
            id: upvoteId,
            userId: upvoterId,
            memberId: memberIdByUserId.get(upvoterId) ?? null,
            postId: postItem.id,
            organizationId,
          });
        }
      }

      const reactors = faker.helpers.arrayElements(
        actorIds,
        faker.number.int({ min: 1, max: Math.min(4, actorIds.length) })
      );

      for (const reactorId of reactors) {
        const emoji = faker.helpers.arrayElement(REACTIONS) ?? "thumbs_up";

        const [existing] = yield* db
          .select({ id: postReactionTable.id })
          .from(postReactionTable)
          .where(
            and(
              eq(postReactionTable.userId, reactorId),
              eq(postReactionTable.postId, postItem.id),
              eq(postReactionTable.emoji, emoji)
            )
          )
          .limit(1);

        if (!existing) {
          const reactionId = yield* PostReactionId.generate;
          yield* db.insert(postReactionTable).values({
            id: reactionId,
            userId: reactorId,
            memberId: memberIdByUserId.get(reactorId) ?? null,
            postId: postItem.id,
            emoji,
          });
        }
      }
    }

    for (const item of createdComments.slice(0, 20)) {
      const reactionCount = faker.number.int({
        min: 1,
        max: Math.min(3, actorIds.length),
      });
      const reactors = faker.helpers.arrayElements(actorIds, reactionCount);

      for (const reactorId of reactors) {
        if (reactorId === item.userId) {
          continue;
        }

        const emoji = faker.helpers.arrayElement(REACTIONS) ?? "thumbs_up";

        const [existing] = yield* db
          .select({ id: commentReactionTable.id })
          .from(commentReactionTable)
          .where(
            and(
              eq(commentReactionTable.userId, reactorId),
              eq(commentReactionTable.commentId, item.id),
              eq(commentReactionTable.emoji, emoji)
            )
          )
          .limit(1);

        if (!existing) {
          const commentReactionId = yield* CommentReactionId.generate;
          yield* db.insert(commentReactionTable).values({
            id: commentReactionId,
            userId: reactorId,
            memberId: memberIdByUserId.get(reactorId) ?? null,
            commentId: item.id,
            emoji,
          });
        }
      }
    }

    console.log(`   Created engagement for ${targetPosts.length} posts`);
  });

const seedChangelogs = ({
  organizationId,
  creatorId,
  creatorMemberId,
  posts,
}: {
  organizationId: string;
  creatorId: string;
  creatorMemberId: string;
  posts: Array<{ id: string; title: string }>;
}) =>
  Effect.gen(function* () {
    const db = yield* Database.Database;

    const [existing] = yield* db
      .select({ id: changelogTable.id })
      .from(changelogTable)
      .where(eq(changelogTable.organizationId, organizationId))
      .limit(1);

    if (existing) {
      console.log("   Changelogs already exist, skipping");
      return;
    }

    const now = new Date();
    const tagIdsByName = new Map<string, string>();

    for (const tagName of CHANGELOG_TAG_NAMES) {
      const tagId = yield* TagId.generate;
      yield* db.insert(tagTable).values({
        id: tagId,
        name: tagName,
        slug: slugify(tagName),
        type: "CHANGELOG",
        organizationId,
        creatorId,
        creatorMemberId,
        createdAt: now,
        updatedAt: now,
      });
      tagIdsByName.set(tagName, tagId);
    }

    let nextPostIndex = 0;

    for (const definition of CHANGELOG_SEEDS) {
      const changelogId = yield* ChangelogId.generate;
      const publishedAt =
        definition.publishedDaysAgo !== null
          ? addDays(now, -definition.publishedDaysAgo)
          : null;
      const scheduledAt =
        definition.scheduledDaysAhead !== null
          ? addDays(now, definition.scheduledDaysAhead)
          : null;

      yield* db.insert(changelogTable).values({
        id: changelogId,
        title: definition.title,
        slug: slugify(definition.title),
        content: definition.content,
        excerpt: htmlToExcerpt(definition.content),
        status: definition.status,
        scheduledAt,
        publishedAt,
        organizationId,
        creatorId,
        creatorMemberId,
        createdAt: publishedAt ?? now,
        updatedAt: now,
      });

      const linkedPosts = posts.slice(
        nextPostIndex,
        nextPostIndex + definition.linkPostCount
      );
      nextPostIndex += definition.linkPostCount;

      for (const postItem of linkedPosts) {
        yield* db.insert(changelogPostTable).values({
          changelogId,
          postId: postItem.id,
          organizationId,
          createdAt: new Date(),
        });
      }

      for (const tagName of definition.tags) {
        const tagId = tagIdsByName.get(tagName);
        if (!tagId) {
          continue;
        }

        const changelogTagId = yield* ChangelogTagId.generate;
        yield* db.insert(changelogTagTable).values({
          id: changelogTagId,
          changelogId,
          tagId,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    console.log(
      `   Seeded ${CHANGELOG_SEEDS.length} changelogs across ${CHANGELOG_TAG_NAMES.length} tags (published, scheduled, draft)`
    );
  });

const seed = Effect.gen(function* () {
  console.log("Starting database seed...\n");

  yield* nukeDatabase();
  console.log("Database reset complete.\n");

  console.log("0) Seeding billing products");
  const products = yield* ensureProducts();
  console.log(
    `   Products: ${products.length} (starter/professional × monthly/yearly)`
  );

  console.log("1) Creating test user and organization");
  const primaryUser = yield* ensureUser(TEST_USER);
  const primaryOrg = yield* ensureOrganization(primaryUser.id);
  const primaryMember = yield* ensureMember({
    organizationId: primaryOrg.id,
    userId: primaryUser.id,
    role: "owner",
  });

  if (!primaryMember) {
    return yield* new SeedDataError({
      message: "Failed to ensure primary member",
    });
  }

  const primaryScenario = ORGANIZATION_PLANS[TEST_USER.email];
  if (primaryScenario) {
    yield* ensureSubscription({
      organizationId: primaryOrg.id,
      products,
      scenario: primaryScenario,
    });
  }

  const mainBoards = yield* ensureBoards({
    organizationId: primaryOrg.id,
    names: ["Bugs", "Features"],
  });

  const mainPosts = yield* ensurePosts({
    organizationId: primaryOrg.id,
    boardIds: mainBoards.map((item) => item.id),
    count: MAIN_POST_COUNT,
    creatorId: primaryUser.id,
    ...(primaryMember ? { creatorMemberId: primaryMember.id } : {}),
  });

  const primarySite = yield* ensureSite({
    organizationId: primaryOrg.id,
    name: primaryOrg.name,
    subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
  });

  console.log(`   Main org: ${primaryOrg.name}`);
  console.log(`   Plan: ${formatPlan(primaryScenario)}`);
  console.log(`   Site subdomain: ${primarySite.subdomain}`);
  console.log(`   Boards: ${mainBoards.map((item) => item.name).join(", ")}`);
  console.log(`   Posts: ${mainPosts.length}`);

  console.log("2) Creating additional users");

  const extraUsers: Array<{ id: string; email: string; joinMainOrg: boolean }> =
    [];

  for (const candidate of TEAM_USERS) {
    const userRecord = yield* ensureUser({
      email: candidate.email,
      name: candidate.name,
      password: TEST_USER.password,
    });

    extraUsers.push({
      id: userRecord.id,
      email: userRecord.email,
      joinMainOrg: candidate.joinMainOrg,
    });

    if (candidate.joinMainOrg) {
      yield* ensureMember({
        organizationId: primaryOrg.id,
        userId: userRecord.id,
        role: candidate.mainOrgRole ?? "manager",
      });

      const personalOrg = yield* ensureOrganization(userRecord.id);

      const planScenario = ORGANIZATION_PLANS[candidate.email];
      if (planScenario) {
        yield* ensureSubscription({
          organizationId: personalOrg.id,
          products,
          scenario: planScenario,
        });
      }

      yield* ensureSite({
        organizationId: personalOrg.id,
        name: personalOrg.name,
        subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
      });
    }
  }

  console.log(
    `   Team members in main org: ${extraUsers.filter((item) => item.joinMainOrg).length}`
  );
  console.log(
    `   External users with separate orgs: ${extraUsers.filter((item) => !item.joinMainOrg).length}`
  );

  console.log("3) Seeding additional organizations");

  const externalUsers = extraUsers.filter((item) => !item.joinMainOrg);

  for (const externalUser of externalUsers) {
    const externalOrg = yield* ensureOrganization(
      externalUser.id,
      faker.company.name()
    );
    const externalMember = yield* ensureMember({
      organizationId: externalOrg.id,
      userId: externalUser.id,
      role: "owner",
    });

    const planScenario = ORGANIZATION_PLANS[externalUser.email];
    if (planScenario) {
      yield* ensureSubscription({
        organizationId: externalOrg.id,
        products,
        scenario: planScenario,
      });
    }

    const externalBoards = yield* ensureBoards({
      organizationId: externalOrg.id,
      names: ["Roadmap", "Requests"],
    });

    const externalPosts = yield* ensurePosts({
      organizationId: externalOrg.id,
      boardIds: externalBoards.map((item) => item.id),
      count: EXTERNAL_POST_COUNT,
      creatorId: externalUser.id,
      ...(externalMember ? { creatorMemberId: externalMember.id } : {}),
    });

    const externalSite = yield* ensureSite({
      organizationId: externalOrg.id,
      name: externalOrg.name,
      subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
    });

    console.log(
      `   Org for ${externalUser.email}: ${externalOrg.name} (${externalPosts.length} posts, plan: ${formatPlan(planScenario)}, subdomain: ${externalSite.subdomain})`
    );
  }

  console.log("4) Seeding comments, likes, and reactions in main org");

  const actorIds = [
    primaryUser.id,
    ...extraUsers.filter((item) => item.joinMainOrg).map((item) => item.id),
    ...extraUsers
      .filter((item) => !item.joinMainOrg)
      .slice(0, 2)
      .map((item) => item.id),
  ];

  yield* seedEngagement({
    organizationId: primaryOrg.id,
    actorIds,
    posts: mainPosts,
  });

  console.log("5) Seeding changelogs in main org");

  yield* seedChangelogs({
    organizationId: primaryOrg.id,
    creatorId: primaryUser.id,
    creatorMemberId: primaryMember.id,
    posts: mainPosts,
  });

  console.log("\nSeed completed successfully.");
  console.log(`Primary user email: ${TEST_USER.email}`);
  console.log(`Primary user password: ${TEST_USER.password}`);
});

const SeedLayer = Layer.merge(
  Database.DatabaseContextLive,
  WorkflowEngine.layerMemory
);

Effect.runPromise(seed.pipe(Effect.provide(SeedLayer))).catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
