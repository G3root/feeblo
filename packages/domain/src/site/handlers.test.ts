import { describe, expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { SiteId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EntitlementPolicy } from "../entitlement/policies";
import { CurrentSession, type Session } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { SiteRpcHandlersEffect } from "./handlers";
import { SitePolicy } from "./policies";
import { SiteRepository } from "./repository";

describe("SiteRpcHandlers", () => {
  type Fixture = {
    membershipId: string;
    organizationId: string;
    siteId: string;
    userId: string;
  };

  const makeSession = (
    fixture: Fixture,
    role: Session["memberships"][number]["role"] | null = "owner"
  ): Session => ({
    user: {
      id: fixture.userId,
      email: "user@example.com",
      name: "Test User",
      restrictedToOrganizationId: null,
    },
    session: { userId: fixture.userId, token: "test-token" },
    organizations: [{ id: fixture.organizationId }],
    memberships: role
      ? [
          {
            membershipId: fixture.membershipId,
            organizationId: fixture.organizationId,
            role,
          },
        ]
      : [],
  });

  const makeFixture = () =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const siteId = yield* SiteId.generate;
      const userId = `user_${organizationId}`;
      const membershipId = `membership_${organizationId}`;
      const now = new Date();
      const subdomain = `test-${organizationId}`;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.userTable).values({
        id: userId,
        email: `${organizationId}@example.com`,
        name: "Test User",
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
        name: "Test site",
        subdomain,
        customDomain: null,
        changelogVisibility: "PUBLIC",
        roadmapVisibility: "PUBLIC",
        hidePoweredBy: false,
        organizationId,
        createdAt: now,
        updatedAt: now,
      });

      return {
        membershipId,
        organizationId,
        siteId,
        userId,
      } satisfies Fixture;
    });

  const addMember = (
    fixture: Fixture,
    role: "owner" | "admin" | "member" = "member"
  ) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const memberId = `member2_${fixture.organizationId}`;
      const secondUserId = `user2_${fixture.organizationId}`;
      const now = new Date();

      yield* db.insert(schema.userTable).values({
        id: secondUserId,
        email: `second_${fixture.organizationId}@example.com`,
        name: "Second User",
      });
      yield* db.insert(schema.memberTable).values({
        id: memberId,
        organizationId: fixture.organizationId,
        userId: secondUserId,
        role,
        createdAt: now,
      });

      return { memberId, secondUserId };
    });

  const RepositoriesTest = Layer.mergeAll(
    WorkspaceRepository.layer,
    SiteRepository.layer
  ).pipe(Layer.provide(Database.PgliteDatabaseLive));

  const HandlerTest = SitePolicy.layer.pipe(
    Layer.provide(EntitlementPolicy.layer),
    Layer.provideMerge(RepositoriesTest)
  );

  const TestLayer = Layer.merge(HandlerTest, Database.PgliteDatabaseLive);

  layer(TestLayer)("handlers", (it) => {
    describe("SiteList", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .SiteList({
                organizationId: fixture.organizationId,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("returns the site for members", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const results = yield* handlers
            .SiteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(results).toHaveLength(1);
          expect(results[0]).toMatchObject({
            id: fixture.siteId,
            name: "Test site",
            organizationId: fixture.organizationId,
            changelogVisibility: "PUBLIC",
            roadmapVisibility: "PUBLIC",
            hidePoweredBy: false,
          });
        })
      );
    });

    describe("SiteListBySubdomain", () => {
      it.effect("returns site by subdomain without auth", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const subdomain = `test-${fixture.organizationId}`;

          const results = yield* handlers.SiteListBySubdomain({
            subdomain,
          });

          expect(results).toHaveLength(1);
          expect(results[0]).toMatchObject({
            id: fixture.siteId,
            name: "Test site",
            subdomain,
            organizationId: fixture.organizationId,
          });
        })
      );

      it.effect("returns empty array for unknown subdomain", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const results = yield* handlers.SiteListBySubdomain({
            subdomain: "nonexistent-subdomain-xyz",
          });

          expect(results).toHaveLength(0);
        })
      );
    });

    describe("SiteUpdate", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .SiteUpdate({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                name: "Updated name",
                changelogVisibility: "HIDDEN",
                roadmapVisibility: "HIDDEN",
                noIndex: false,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects a regular member (non-owner/non-admin)", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* addMember(fixture, "member");

          const error = yield* Effect.flip(
            handlers
              .SiteUpdate({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                name: "Updated name",
                changelogVisibility: "HIDDEN",
                roadmapVisibility: "HIDDEN",
                noIndex: false,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "member")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("allows an admin to update the site", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* addMember(fixture, "admin");

          yield* handlers
            .SiteUpdate({
              id: fixture.siteId,
              organizationId: fixture.organizationId,
              name: "Admin updated",
              changelogVisibility: "HIDDEN",
              roadmapVisibility: "HIDDEN",
              noIndex: true,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            );

          const results = yield* handlers
            .SiteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(results[0]).toMatchObject({
            name: "Admin updated",
            changelogVisibility: "HIDDEN",
            roadmapVisibility: "HIDDEN",
            noIndex: true,
          });
        })
      );

      it.effect("allows an owner to update the site", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();

          yield* handlers
            .SiteUpdate({
              id: fixture.siteId,
              organizationId: fixture.organizationId,
              name: "Owner updated",
              changelogVisibility: "PUBLIC",
              roadmapVisibility: "PUBLIC",
              noIndex: false,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          const results = yield* handlers
            .SiteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(results[0]).toMatchObject({
            name: "Owner updated",
          });
        })
      );
    });

    describe("SiteHidePoweredByBranding", () => {
      it.effect("rejects users without a membership", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          const error = yield* Effect.flip(
            handlers
              .SiteHidePoweredByBranding({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                hidePoweredBy: true,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, null)
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects a regular member", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* addMember(fixture, "member");

          const error = yield* Effect.flip(
            handlers
              .SiteHidePoweredByBranding({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                hidePoweredBy: true,
              })
              .pipe(
                Effect.provideService(
                  CurrentSession,
                  makeSession(fixture, "member")
                )
              )
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect("rejects free plan users from hiding powered-by branding", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();

          const error = yield* Effect.flip(
            handlers
              .SiteHidePoweredByBranding({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                hidePoweredBy: true,
              })
              .pipe(Effect.provideService(CurrentSession, makeSession(fixture)))
          );

          expect(error._tag).toBe("PolicyDenied");
        })
      );

      it.effect(
        "allows free plan users to show powered-by branding (hide=false)",
        () =>
          Effect.gen(function* () {
            const handlers = yield* SiteRpcHandlersEffect;
            const fixture = yield* makeFixture();

            yield* handlers
              .SiteHidePoweredByBranding({
                id: fixture.siteId,
                organizationId: fixture.organizationId,
                hidePoweredBy: false,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            const results = yield* handlers
              .SiteList({
                organizationId: fixture.organizationId,
              })
              .pipe(
                Effect.provideService(CurrentSession, makeSession(fixture))
              );

            expect(results[0]?.hidePoweredBy).toBe(false);
          })
      );

      it.effect("allows an admin to update hidePoweredBy to false", () =>
        Effect.gen(function* () {
          const handlers = yield* SiteRpcHandlersEffect;
          const fixture = yield* makeFixture();
          yield* addMember(fixture, "admin");

          yield* handlers
            .SiteHidePoweredByBranding({
              id: fixture.siteId,
              organizationId: fixture.organizationId,
              hidePoweredBy: false,
            })
            .pipe(
              Effect.provideService(
                CurrentSession,
                makeSession(fixture, "admin")
              )
            );

          const results = yield* handlers
            .SiteList({
              organizationId: fixture.organizationId,
            })
            .pipe(Effect.provideService(CurrentSession, makeSession(fixture)));

          expect(results[0]?.hidePoweredBy).toBe(false);
        })
      );
    });
  });
});
