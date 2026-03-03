import { DB } from "@feeblo/db";
import {
  member as memberTable,
  organization as organizationTable,
  user as userTable,
} from "@feeblo/db/schema/auth";
import { board as boardTable } from "@feeblo/db/schema/feedback";
import { generateId } from "@feeblo/utils/id";
import { slugify } from "@feeblo/utils/url";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";

export class OnboardingRepository extends Effect.Service<OnboardingRepository>()(
  "OnboardingRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findFirstOrganizationIdForUser: ({ userId }: { userId: string }) =>
          Effect.gen(function* () {
            const [row] = yield* db
              .select({
                organizationId: memberTable.organizationId,
              })
              .from(memberTable)
              .where(eq(memberTable.userId, userId))
              .orderBy(asc(memberTable.createdAt))
              .limit(1);

            return row?.organizationId ?? null;
          }),
        isOrganizationSlugTaken: ({ slug }: { slug: string }) =>
          Effect.gen(function* () {
            const [row] = yield* db
              .select({ id: organizationTable.id })
              .from(organizationTable)
              .where(and(eq(organizationTable.slug, slug)))
              .limit(1);

            return Boolean(row);
          }),
        updateOrganization: ({
          organizationId,
          name,
          slug,
        }: {
          organizationId: string;
          name: string;
          slug: string;
        }) =>
          Effect.gen(function* () {
            yield* db
              .update(organizationTable)
              .set({
                name,
                slug,
              })
              .where(eq(organizationTable.id, organizationId));
          }),
        createInitialWorkspaceForUser: ({
          userId,
          workspaceName,
          slug,
        }: {
          userId: string;
          workspaceName: string;
          slug: string;
        }) =>
          Effect.gen(function* () {
            const existingOrgIdByUser = yield* Effect.gen(function* () {
              const [existingOrg] = yield* db
                .select({ id: organizationTable.id })
                .from(organizationTable)
                .where(eq(organizationTable.id, userId))
                .limit(1);
              return existingOrg?.id;
            });

            const organizationId = existingOrgIdByUser ?? userId;

            if (!existingOrgIdByUser) {
              yield* db.insert(organizationTable).values({
                id: organizationId,
                name: workspaceName,
                slug,
                logo: null,
                createdAt: new Date(),
              });
            }

            const [existingOwnerMembership] = yield* db
              .select({ id: memberTable.id })
              .from(memberTable)
              .where(
                and(
                  eq(memberTable.organizationId, organizationId),
                  eq(memberTable.userId, userId)
                )
              )
              .limit(1);

            if (!existingOwnerMembership) {
              yield* db.insert(memberTable).values({
                id: generateId("member"),
                organizationId,
                role: "owner",
                createdAt: new Date(),
                userId,
              });
            }

            const [existingBoard] = yield* db
              .select({ id: boardTable.id })
              .from(boardTable)
              .where(eq(boardTable.organizationId, organizationId))
              .limit(1);

            if (!existingBoard) {
              const defaultBoards = ["🐞 Bugs", "💡 Features"] as const;

              for (const boardName of defaultBoards) {
                yield* db.insert(boardTable).values({
                  id: generateId("board"),
                  name: boardName,
                  slug: slugify(boardName),
                  visibility: "PUBLIC",
                  organizationId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            }

            return organizationId;
          }),
        markUserOnboarded: ({ userId }: { userId: string }) =>
          Effect.gen(function* () {
            yield* db
              .update(userTable)
              .set({
                onboardedOn: new Date(),
              })
              .where(eq(userTable.id, userId));
          }),
      };
    }),
  }
) {}
