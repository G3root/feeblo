import { DB } from "@feeblo/db";
import { user as userTable } from "@feeblo/db/schema/auth";
import { changelog as changelogTable } from "@feeblo/db/schema/feedback";
import { slugify } from "@feeblo/utils/url";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Array as EffectArray } from "effect";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

type TChangelogCreateInternal = TChangelogCreate & {
  creatorId: string;
  creatorMemberId?: string;
};

type TFindByCreatorId = {
  id: string;
  organizationId: string;
  memberId: string;
};

export class ChangelogRepository extends Effect.Service<ChangelogRepository>()(
  "ChangelogRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findByCreatorId: ({ id, organizationId, memberId }: TFindByCreatorId) =>
          db
            .select({ id: changelogTable.id })
            .from(changelogTable)
            .where(
              and(
                eq(changelogTable.id, id),
                eq(changelogTable.organizationId, organizationId),
                eq(changelogTable.creatorMemberId, memberId)
              )
            )
            .pipe(Effect.map(EffectArray.get(0))),

        findMany: ({ organizationId }: TChangelogList) =>
          db
            .select({
              id: changelogTable.id,
              title: changelogTable.title,
              slug: changelogTable.slug,
              content: changelogTable.content,
              organizationId: changelogTable.organizationId,
              creatorMemberId: changelogTable.creatorMemberId,
              creatorId: changelogTable.creatorId,
              createdAt: changelogTable.createdAt,
              updatedAt: changelogTable.updatedAt,
              user: {
                name: sql<string | null>`${userTable.name}`,
                image: sql<string | null>`${userTable.image}`,
              },
            })
            .from(changelogTable)
            .leftJoin(userTable, eq(userTable.id, changelogTable.creatorId))
            .where(eq(changelogTable.organizationId, organizationId)),

        create: ({
          id,
          title,
          slug,
          content,
          organizationId,
          creatorId,
          creatorMemberId,
        }: TChangelogCreateInternal) =>
          db
            .insert(changelogTable)
            .values({
              id,
              title,
              slug: slug || slugify(title),
              content,
              organizationId,
              creatorId,
              creatorMemberId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .pipe(Effect.asVoid),

        update: ({ id, title, slug, content, organizationId }: TChangelogUpdate) =>
          db
            .update(changelogTable)
            .set({
              title,
              slug: slug || slugify(title),
              content,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(changelogTable.id, id),
                eq(changelogTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.asVoid),

        delete: ({ id, organizationId }: TChangelogDelete) =>
          db
            .delete(changelogTable)
            .where(
              and(
                eq(changelogTable.id, id),
                eq(changelogTable.organizationId, organizationId)
              )
            )
            .pipe(Effect.asVoid),
      };
    }),
  }
) {}
