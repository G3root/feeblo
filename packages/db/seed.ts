// biome-ignore-all lint/suspicious/noConsole: Seed script requires console output
import { faker } from "@faker-js/faker";
import { initAuthHandler } from "@feeblo/auth/server";
import {
  BoardId,
  CommentId,
  CommentReactionId,
  MemberId,
  PostId,
  PostReactionId,
  PostStatusId,
  SiteId,
  UpvoteId,
  WorkspaceId,
} from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { and, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";
import { Database } from "./src";
import { nukeDatabase } from "./src/nuke";
import {
  boardTable,
  commentReactionTable,
  commentTable,
  DEFAULT_POST_STATUSES,
  memberTable,
  organizationTable,
  postReactionTable,
  postStatusTable,
  postTable,
  siteTable,
  upvoteTable,
  userTable,
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

class SeedDataError extends Data.TaggedError("SeedDataError")<{
  readonly message: string;
}> {}

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

const ensureOrganization = (userId: string) =>
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
          name: "Personal",
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

const seed = Effect.gen(function* () {
  console.log("Starting database seed...\n");

  yield* nukeDatabase();
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
    ...(primaryMember ? { creatorMemberId: primaryMember.id } : {}),
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

      const personalOrg = yield* ensureOrganization(userRecord.id);
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
      ...(externalMember ? { creatorMemberId: externalMember.id } : {}),
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

const SeedLayer = Database.DatabaseContextLive;

Effect.runPromise(seed.pipe(Effect.provide(SeedLayer))).catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
