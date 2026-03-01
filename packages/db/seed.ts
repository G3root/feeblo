// biome-ignore-all lint/suspicious/noConsole: Seed script requires console output
import { faker } from "@faker-js/faker";
import { initAuthHandler } from "@feeblo/auth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DB } from "./src";
import {
  board,
  comment,
  commentReaction,
  member,
  organization,
  post,
  postReaction,
  site,
  upvote,
  user,
} from "./src/schema";

const TEST_USER = {
  email: "test@feeblo.dev",
  password: "TestPassword123!",
  name: "Test User",
};

const TEAM_USERS = [
  { email: "alex@feeblo.dev", name: "Alex", joinMainOrg: true },
  { email: "sam@feeblo.dev", name: "Sam", joinMainOrg: true },
  { email: "jordan@feeblo.dev", name: "Jordan", joinMainOrg: true },
  { email: "morgan@feeblo.dev", name: "Morgan", joinMainOrg: false },
  { email: "taylor@feeblo.dev", name: "Taylor", joinMainOrg: false },
] as const;

const MAIN_POST_COUNT = 40;
const EXTERNAL_POST_COUNT = 12;

const STATUSES: NonNullable<typeof post.$inferInsert.status>[] = [
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "PAUSED",
];

const REACTIONS = ["👍", "❤️", "🔥", "😂", "🎯"];

const makeId = (prefix: string) => `${prefix}-${faker.string.alphanumeric(12)}`;
const makePublicId = () => faker.string.alphanumeric(12).toLowerCase();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

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
    const db = yield* DB;
    const auth = yield* initAuthHandler();

    let [existingUser] = yield* db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(eq(user.email, email))
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
        return yield* Effect.fail(new Error(`Failed to create user ${email}`));
      }

      [existingUser] = yield* db
        .select({
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
    }

    if (!existingUser) {
      return yield* Effect.fail(
        new Error(`User ${email} not found after creation`)
      );
    }

    if (!existingUser.emailVerified) {
      yield* db
        .update(user)
        .set({ emailVerified: true })
        .where(eq(user.id, existingUser.id));
    }

    return existingUser;
  });

const ensureOrganization = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;

    let [org] = yield* db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.id, userId))
      .limit(1);

    if (!org) {
      [org] = yield* db
        .insert(organization)
        .values({
          id: userId,
          name: "Personal",
          slug: userId,
          createdAt: new Date(),
        })
        .returning({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        });
    }

    if (!org) {
      return yield* Effect.fail(
        new Error(`Failed to ensure organization for ${userId}`)
      );
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
    const db = yield* DB;

    let [existing] = yield* db
      .select({ id: site.id, subdomain: site.subdomain })
      .from(site)
      .where(eq(site.organizationId, organizationId))
      .limit(1);

    if (!existing) {
      [existing] = yield* db
        .insert(site)
        .values({
          id: makeId("ste"),
          name,
          subdomain,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: site.id, subdomain: site.subdomain });
    }

    if (!existing) {
      return yield* Effect.fail(
        new Error(`Failed to ensure site for organization ${organizationId}`)
      );
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
  role: NonNullable<typeof member.$inferInsert.role>;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;

    let [existing] = yield* db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId)
        )
      )
      .limit(1);

    if (!existing) {
      [existing] = yield* db
        .insert(member)
        .values({
          id: makeId("mem"),
          organizationId,
          userId,
          role,
          createdAt: new Date(),
        })
        .returning({ id: member.id, role: member.role });
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
    const db = yield* DB;

    let boards = yield* db
      .select({ id: board.id, name: board.name })
      .from(board)
      .where(eq(board.organizationId, organizationId));

    if (boards.length === 0) {
      for (const name of names) {
        yield* db.insert(board).values({
          id: makeId("brd"),
          name,
          slug: slugify(name),
          visibility: "PUBLIC",
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      boards = yield* db
        .select({ id: board.id, name: board.name })
        .from(board)
        .where(eq(board.organizationId, organizationId));
    }

    return boards;
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
    const db = yield* DB;
    const now = new Date();

    const [existing] = yield* db
      .select({ id: post.id })
      .from(post)
      .where(eq(post.organizationId, organizationId))
      .limit(1);

    if (!existing) {
      for (let i = 0; i < count; i++) {
        const boardId = boardIds[i % boardIds.length] ?? boardIds[0];

        if (!boardId) {
          return yield* Effect.fail(new Error("No board found to seed posts"));
        }

        const title = faker.company.catchPhrase();

        yield* db.insert(post).values({
          id: makeId("pst"),
          title,
          publicId: makePublicId(),
          slug: slugify(`${title}-${i + 1}`),
          content: faker.lorem.paragraphs({ min: 2, max: 4 }),
          boardId,
          status: faker.helpers.arrayElement(STATUSES) ?? "PLANNED",
          organizationId,
          creatorId: creatorId ?? null,
          creatorMemberId: creatorMemberId ?? null,
          createdAt: faker.date.recent({ days: 120, refDate: now }),
          updatedAt: now,
        });
      }
    }

    return yield* db
      .select({ id: post.id, title: post.title })
      .from(post)
      .where(eq(post.organizationId, organizationId));
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
    const db = yield* DB;

    if (actorIds.length === 0 || posts.length === 0) {
      return;
    }

    const membershipRows =
      actorIds.length > 0
        ? yield* db
            .select({ userId: member.userId, memberId: member.id })
            .from(member)
            .where(
              and(
                eq(member.organizationId, organizationId),
                inArray(member.userId, actorIds)
              )
            )
        : [];

    const memberIdByUserId = new Map(
      membershipRows.map((item) => [item.userId, item.memberId])
    );

    const [existingComment] = yield* db
      .select({ id: comment.id })
      .from(comment)
      .where(eq(comment.organizationId, organizationId))
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

        const commentId = makeId("cmt");

        yield* db.insert(comment).values({
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
          .select({ id: upvote.id })
          .from(upvote)
          .where(
            and(eq(upvote.userId, upvoterId), eq(upvote.postId, postItem.id))
          )
          .limit(1);

        if (!existing) {
          yield* db.insert(upvote).values({
            id: makeId("upv"),
            userId: upvoterId,
            memberId: memberIdByUserId.get(upvoterId) ?? null,
            postId: postItem.id,
          });
        }
      }

      const reactors = faker.helpers.arrayElements(
        actorIds,
        faker.number.int({ min: 1, max: Math.min(4, actorIds.length) })
      );

      for (const reactorId of reactors) {
        const emoji = faker.helpers.arrayElement(REACTIONS) ?? "👍";

        const [existing] = yield* db
          .select({ id: postReaction.id })
          .from(postReaction)
          .where(
            and(
              eq(postReaction.userId, reactorId),
              eq(postReaction.postId, postItem.id),
              eq(postReaction.emoji, emoji)
            )
          )
          .limit(1);

        if (!existing) {
          yield* db.insert(postReaction).values({
            id: makeId("rct"),
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

        const emoji = faker.helpers.arrayElement(REACTIONS) ?? "👍";

        const [existing] = yield* db
          .select({ id: commentReaction.id })
          .from(commentReaction)
          .where(
            and(
              eq(commentReaction.userId, reactorId),
              eq(commentReaction.commentId, item.id),
              eq(commentReaction.emoji, emoji)
            )
          )
          .limit(1);

        if (!existing) {
          yield* db.insert(commentReaction).values({
            id: makeId("crt"),
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

const seed = Effect.gen(function* () {
  console.log("Starting database seed...\n");

  const db = yield* DB;
  yield* db.execute(
    sql`truncate table
      "commentReaction",
      "comment",
      "postReaction",
      "upvote",
      "post",
      "board",
      "site",
      "invitation",
      "member",
      "organization",
      "two_factor",
      "verification",
      "account",
      "session",
      "user"
    cascade`
  );
  console.log("Database reset complete.\n");

  console.log("1) Creating test user and organization");
  const primaryUser = yield* ensureUser(TEST_USER);
  const primaryOrg = yield* ensureOrganization(primaryUser.id);
  const primaryMember = yield* ensureMember({
    organizationId: primaryOrg.id,
    userId: primaryUser.id,
    role: "owner",
  });

  const mainBoards = yield* ensureBoards({
    organizationId: primaryOrg.id,
    names: ["Bugs", "Features"],
  });

  const mainPosts = yield* ensurePosts({
    organizationId: primaryOrg.id,
    boardIds: mainBoards.map((item) => item.id),
    count: MAIN_POST_COUNT,
    creatorId: primaryUser.id,
    creatorMemberId: primaryMember?.id,
  });

  const primarySite = yield* ensureSite({
    organizationId: primaryOrg.id,
    name: primaryOrg.name,
    subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
  });

  console.log(`   Main org: ${primaryOrg.name}`);
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
        role: "member",
      });
    }

    const personalOrg = yield* ensureOrganization(userRecord.id);
    yield* ensureSite({
      organizationId: personalOrg.id,
      name: personalOrg.name,
      subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
    });
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
    const externalOrg = yield* ensureOrganization(externalUser.id);
    const externalMember = yield* ensureMember({
      organizationId: externalOrg.id,
      userId: externalUser.id,
      role: "owner",
    });
    const externalBoards = yield* ensureBoards({
      organizationId: externalOrg.id,
      names: ["Roadmap", "Requests"],
    });

    const externalPosts = yield* ensurePosts({
      organizationId: externalOrg.id,
      boardIds: externalBoards.map((item) => item.id),
      count: EXTERNAL_POST_COUNT,
      creatorId: externalUser.id,
      creatorMemberId: externalMember?.id,
    });

    const externalSite = yield* ensureSite({
      organizationId: externalOrg.id,
      name: externalOrg.name,
      subdomain: `${faker.word.adjective()}-${faker.word.noun()}`,
    });

    console.log(
      `   Org for ${externalUser.email}: ${externalOrg.name} (${externalPosts.length} posts, subdomain: ${externalSite.subdomain})`
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

  console.log("\nSeed completed successfully.");
  console.log(`Primary user email: ${TEST_USER.email}`);
  console.log(`Primary user password: ${TEST_USER.password}`);
});

const SeedLayer = DB.Client;

seed.pipe(Effect.provide(SeedLayer), Effect.runPromise).catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
