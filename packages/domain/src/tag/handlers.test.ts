import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import {
  BoardId,
  ChangelogId,
  type LegidOf,
  PostId,
  PostStatusId,
  SiteId,
  TagId,
  WorkspaceId,
} from "@feeblo/id";
import type { Role } from "@feeblo/permissions";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import { PostActivityRepository } from "../post-activity/repository";
import { CurrentSession, type Session } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { TagRpcHandlersEffect } from "./handlers";
import { TagPolicy } from "./policies";
import { TagRepository } from "./repository";

describe("TagRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: LegidOf<"WorkspaceId">;
    postId: LegidOf<"PostId">;
    statusId: LegidOf<"PostStatusId">;
    userId: string;
  };
  const session = (f: Fixture, role: Role | "none" = "owner"): Session => ({
    user: {
      id: f.userId,
      email: "user@example.com",
      name: "User",
      restrictedToOrganizationId: null,
    },
    session: { userId: f.userId, token: "token" },
    organizations: [{ id: f.organizationId }],
    memberships:
      role === "none"
        ? []
        : [
            {
              membershipId: f.membershipId,
              organizationId: f.organizationId,
              role,
            },
          ],
  });
  // A different member of the same organization (not the post/changelog creator).
  type OtherContributor = {
    session: Session;
    membershipId: string;
  };
  const otherContributor = (f: Fixture): OtherContributor => {
    const userId = `other_${f.userId}`;
    const membershipId = `other_member_${f.membershipId}`;
    return {
      session: {
        user: {
          id: userId,
          email: "other@example.com",
          name: "Other",
          restrictedToOrganizationId: null,
        },
        session: { userId, token: "token" },
        organizations: [{ id: f.organizationId }],
        memberships: [
          {
            membershipId,
            organizationId: f.organizationId,
            role: "contributor",
          },
        ],
      },
      membershipId,
    };
  };
  const fixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const postId = yield* PostId.generate;
      const statusId = yield* PostStatusId.generate;
      const siteId = yield* SiteId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `member_${organizationId}`;
      const now = new Date();
      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "User",
      });
      yield* db.insert(schema.memberTable).values({
        id: membershipId,
        organizationId,
        userId,
        role: "owner",
        createdAt: now,
      });
      yield* db.insert(schema.siteTable).values({
        id: siteId,
        name: "Organization",
        subdomain: `org-${organizationId}`,
        customDomain: null,
        changelogVisibility: "PUBLIC",
        roadmapVisibility: "PUBLIC",
        hidePoweredBy: false,
        noIndex: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        name: "Board",
        slug: boardId,
        visibility: "PUBLIC",
        organizationId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        type: "PENDING",
        orderIndex: 0,
        organizationId,
      });
      yield* db.insert(schema.postTable).values({
        id: postId,
        title: "Post",
        content: "Content",
        slug: postId,
        excerpt: "Content",
        boardId,
        organizationId,
        statusId,
        creatorId: userId,
        creatorMemberId: membershipId,
        createdAt: now,
        updatedAt: now,
      });
      return {
        membershipId,
        organizationId,
        postId,
        statusId,
        userId,
      } satisfies Fixture;
    });
  const Repositories = Layer.mergeAll(
    TagRepository.layer,
    SiteRepository.layer,
    WorkspaceRepository.layer,
    PostActivityRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));
  const Entitlements = EntitlementPolicy.layer.pipe(
    Layer.provide(Repositories)
  );
  const Policies = Layer.mergeAll(TagPolicy.layer, SitePolicy.layer).pipe(
    Layer.provide(Entitlements),
    Layer.provide(Repositories)
  );
  const TestLayer = Layer.mergeAll(Repositories, Entitlements, Policies);

  layer(Layer.merge(TestLayer, Database.PgliteDatabaseLive))(
    "handlers",
    (it) => {
      it.effect(
        "lists tags only for members while the public endpoint remains readable",
        () =>
          Effect.gen(function* () {
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Feature",
                type: "FEEDBACK",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* handlers
              .PostTagSet({
                organizationId: f.organizationId,
                postId: f.postId,
                tagIds: [tagId],
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            const error = yield* Effect.flip(
              handlers
                .TagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f, "none")))
            );
            expect(error._tag).toBe("PolicyDenied");
            const publicTags = yield* handlers.TagListPublic({
              organizationId: f.organizationId,
            });
            expect(publicTags).toMatchObject([
              { id: tagId, name: "Feature", type: "FEEDBACK" },
            ]);
            expect(publicTags[0]).not.toHaveProperty("creatorId");
          })
      );
      it.effect("allows tag creators to update their tags", () =>
        Effect.gen(function* () {
          const handlers = yield* TagRpcHandlersEffect;
          const f = yield* fixture();
          const tagId = yield* TagId.generate;
          yield* handlers
            .TagCreate({
              id: tagId,
              name: "Old name",
              type: "FEEDBACK",
              organizationId: f.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          yield* handlers
            .TagUpdate({
              id: tagId,
              name: "New name",
              type: "FEEDBACK",
              organizationId: f.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          expect(
            yield* handlers
              .TagList({ organizationId: f.organizationId })
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toMatchObject([{ id: tagId, name: "New name", slug: "new-name" }]);
        })
      );
      it.effect("assigns each feedback tag to a post once", () =>
        Effect.gen(function* () {
          const handlers = yield* TagRpcHandlersEffect;
          const f = yield* fixture();
          const tagId = yield* TagId.generate;
          yield* handlers
            .TagCreate({
              id: tagId,
              name: "Feature",
              type: "FEEDBACK",
              organizationId: f.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          yield* handlers
            .PostTagSet({
              organizationId: f.organizationId,
              postId: f.postId,
              tagIds: [tagId, tagId],
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          expect(
            yield* handlers
              .PostTagList({ organizationId: f.organizationId })
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toMatchObject([{ postId: f.postId, tagId }]);
        })
      );
      it.effect("allows contributors to set tags on posts they created", () =>
        Effect.gen(function* () {
          const handlers = yield* TagRpcHandlersEffect;
          const f = yield* fixture();
          const tagId = yield* TagId.generate;
          yield* handlers
            .TagCreate({
              id: tagId,
              name: "Feature",
              type: "FEEDBACK",
              organizationId: f.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          yield* handlers
            .PostTagSet({
              organizationId: f.organizationId,
              postId: f.postId,
              tagIds: [tagId],
            })
            .pipe(
              Effect.provideService(CurrentSession, session(f, "contributor"))
            );
          expect(
            yield* handlers
              .PostTagList({ organizationId: f.organizationId })
              .pipe(Effect.provideService(CurrentSession, session(f)))
          ).toMatchObject([{ postId: f.postId, tagId }]);
        })
      );
      it.effect(
        "denies contributors from setting tags on posts they did not create",
        () =>
          Effect.gen(function* () {
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Feature",
                type: "FEEDBACK",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            const error = yield* Effect.flip(
              handlers
                .PostTagSet({
                  organizationId: f.organizationId,
                  postId: f.postId,
                  tagIds: [tagId],
                })
                .pipe(
                  Effect.provideService(
                    CurrentSession,
                    otherContributor(f).session
                  )
                )
            );
            expect(error._tag).toBe("PolicyDenied");
            expect(
              yield* handlers
                .PostTagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toHaveLength(0);
          })
      );
      it.effect(
        "allows managers to set tags on posts they did not create",
        () =>
          Effect.gen(function* () {
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Feature",
                type: "FEEDBACK",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* handlers
              .PostTagSet({
                organizationId: f.organizationId,
                postId: f.postId,
                tagIds: [tagId],
              })
              .pipe(
                Effect.provideService(CurrentSession, session(f, "manager"))
              );
            expect(
              yield* handlers
                .PostTagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toMatchObject([{ postId: f.postId, tagId }]);
          })
      );
      it.effect("records add/remove activities when tags change", () =>
        Effect.gen(function* () {
          const db = yield* currentDb;
          const handlers = yield* TagRpcHandlersEffect;
          const f = yield* fixture();
          const tagA = yield* TagId.generate;
          const tagB = yield* TagId.generate;
          for (const tagId of [tagA, tagB]) {
            yield* handlers
              .TagCreate({
                id: tagId,
                name: tagId,
                type: "FEEDBACK",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
          }

          yield* handlers
            .PostTagSet({
              organizationId: f.organizationId,
              postId: f.postId,
              tagIds: [tagA, tagB],
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));
          yield* handlers
            .PostTagSet({
              organizationId: f.organizationId,
              postId: f.postId,
              tagIds: [tagB],
            })
            .pipe(Effect.provideService(CurrentSession, session(f)));

          const rows = yield* db
            .select({
              kind: schema.postActivityTable.kind,
              nextValue: schema.postActivityTable.nextValue,
              postId: schema.postActivityTable.postId,
              actorId: schema.postActivityTable.actorId,
              actorMemberId: schema.postActivityTable.actorMemberId,
            })
            .from(schema.postActivityTable)
            .where(
              and(
                eq(schema.postActivityTable.postId, f.postId),
                eq(schema.postActivityTable.kind, "TAG_ADDED"),
                eq(schema.postActivityTable.nextValue, tagB)
              )
            );
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            kind: "TAG_ADDED",
            nextValue: tagB,
            postId: f.postId,
            actorId: f.userId,
            actorMemberId: f.membershipId,
          });
          const addedRows = yield* db
            .select({
              id: schema.postActivityTable.id,
              actorId: schema.postActivityTable.actorId,
              actorMemberId: schema.postActivityTable.actorMemberId,
            })
            .from(schema.postActivityTable)
            .where(
              and(
                eq(schema.postActivityTable.postId, f.postId),
                eq(schema.postActivityTable.kind, "TAG_ADDED"),
                eq(schema.postActivityTable.nextValue, tagA)
              )
            );
          expect(addedRows).toHaveLength(1);
          expect(addedRows[0]).toMatchObject({
            actorId: f.userId,
            actorMemberId: f.membershipId,
          });
          const removedRows = yield* db
            .select({
              id: schema.postActivityTable.id,
              actorId: schema.postActivityTable.actorId,
              actorMemberId: schema.postActivityTable.actorMemberId,
            })
            .from(schema.postActivityTable)
            .where(
              and(
                eq(schema.postActivityTable.postId, f.postId),
                eq(schema.postActivityTable.kind, "TAG_REMOVED"),
                eq(schema.postActivityTable.nextValue, tagA)
              )
            );
          expect(removedRows).toHaveLength(1);
          expect(removedRows[0]).toMatchObject({
            actorId: f.userId,
            actorMemberId: f.membershipId,
          });
        })
      );
      it.effect(
        "denies contributors from setting tags on changelogs they did not create",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            const changelogId = yield* ChangelogId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Ship",
                type: "CHANGELOG",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* db.insert(schema.changelogTable).values({
              id: changelogId,
              title: "Draft",
              slug: changelogId,
              content: "Content",
              status: "draft",
              organizationId: f.organizationId,
              creatorId: f.userId,
              creatorMemberId: f.membershipId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            const error = yield* Effect.flip(
              handlers
                .ChangelogTagSet({
                  organizationId: f.organizationId,
                  changelogId,
                  tagIds: [tagId],
                })
                .pipe(
                  Effect.provideService(
                    CurrentSession,
                    otherContributor(f).session
                  )
                )
            );
            expect(error._tag).toBe("PolicyDenied");
          })
      );
      it.effect(
        "denies contributors from setting tags on changelogs even when they created them",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            const changelogId = yield* ChangelogId.generate;
            const other = otherContributor(f);
            yield* db.insert(schema.userTable).values({
              id: other.session.user.id,
              email: "other@example.com",
              name: "Other",
            });
            yield* db.insert(schema.memberTable).values({
              id: other.membershipId,
              organizationId: f.organizationId,
              userId: other.session.user.id,
              role: "contributor",
              createdAt: new Date(),
            });
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Ship",
                type: "CHANGELOG",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* db.insert(schema.changelogTable).values({
              id: changelogId,
              title: "Draft",
              slug: changelogId,
              content: "Content",
              status: "draft",
              organizationId: f.organizationId,
              creatorId: other.session.user.id,
              creatorMemberId: other.membershipId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            const error = yield* Effect.flip(
              handlers
                .ChangelogTagSet({
                  organizationId: f.organizationId,
                  changelogId,
                  tagIds: [tagId],
                })
                .pipe(Effect.provideService(CurrentSession, other.session))
            );
            expect(error._tag).toBe("PolicyDenied");
            expect(
              yield* handlers
                .ChangelogTagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toHaveLength(0);
          })
      );
      it.effect(
        "hides post tags on private boards from the public endpoint",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            const privateBoardId = yield* BoardId.generate;
            const privatePostId = yield* PostId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Feature",
                type: "FEEDBACK",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* db.insert(schema.boardTable).values({
              id: privateBoardId,
              name: "Private",
              slug: privateBoardId,
              visibility: "PRIVATE",
              organizationId: f.organizationId,
              creatorId: f.userId,
              creatorMemberId: f.membershipId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            yield* db.insert(schema.postTable).values({
              id: privatePostId,
              title: "Private post",
              content: "Content",
              slug: privatePostId,
              excerpt: "Content",
              boardId: privateBoardId,
              organizationId: f.organizationId,
              statusId: f.statusId,
              creatorId: f.userId,
              creatorMemberId: f.membershipId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            yield* handlers
              .PostTagSet({
                organizationId: f.organizationId,
                postId: privatePostId,
                tagIds: [tagId],
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            expect(
              yield* handlers.PostTagListPublic({
                organizationId: f.organizationId,
              })
            ).toHaveLength(0);
            expect(
              yield* handlers.TagListPublic({
                organizationId: f.organizationId,
              })
            ).toHaveLength(0);
            expect(
              yield* handlers
                .PostTagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toHaveLength(1);
          })
      );
      it.effect(
        "hides changelog tags on unpublished changelogs from the public endpoint",
        () =>
          Effect.gen(function* () {
            const db = yield* currentDb;
            const handlers = yield* TagRpcHandlersEffect;
            const f = yield* fixture();
            const tagId = yield* TagId.generate;
            const changelogId = yield* ChangelogId.generate;
            yield* handlers
              .TagCreate({
                id: tagId,
                name: "Ship",
                type: "CHANGELOG",
                organizationId: f.organizationId,
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            yield* db.insert(schema.changelogTable).values({
              id: changelogId,
              title: "Draft",
              slug: changelogId,
              content: "Content",
              status: "draft",
              organizationId: f.organizationId,
              creatorId: f.userId,
              creatorMemberId: f.membershipId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            yield* handlers
              .ChangelogTagSet({
                organizationId: f.organizationId,
                changelogId,
                tagIds: [tagId],
              })
              .pipe(Effect.provideService(CurrentSession, session(f)));
            expect(
              yield* handlers.ChangelogTagListPublic({
                organizationId: f.organizationId,
              })
            ).toHaveLength(0);
            expect(
              yield* handlers.TagListPublic({
                organizationId: f.organizationId,
              })
            ).toHaveLength(0);
            expect(
              yield* handlers
                .ChangelogTagList({ organizationId: f.organizationId })
                .pipe(Effect.provideService(CurrentSession, session(f)))
            ).toHaveLength(1);
          })
      );
    }
  );
});
