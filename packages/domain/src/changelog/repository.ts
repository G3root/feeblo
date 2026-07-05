import { schema, currentDb } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

interface TChangelogCreateInternal extends TChangelogCreate {
  creatorId: string;
  creatorMemberId?: string;
}

interface TFindByCreatorId {
  id: string;
  memberId: string;
  organizationId: string;
}

const makeChangelogRepository = Effect.gen(function* () {
  return {
    findByCreatorId: ({ id, organizationId, memberId }: TFindByCreatorId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({ id: schema.changelogTable.id })
          .from(schema.changelogTable)
          .where(
            and(
              eq(schema.changelogTable.id, id),
              eq(schema.changelogTable.organizationId, organizationId),
              eq(schema.changelogTable.creatorMemberId, memberId)
            )
          )
          .pipe(Effect.map(EffectArray.get(0)));
      }),

    findMany: ({ organizationId }: TChangelogList) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.changelogTable.id,
            title: schema.changelogTable.title,
            slug: schema.changelogTable.slug,
            content: schema.changelogTable.content,
            status: schema.changelogTable.status,
            scheduledAt: schema.changelogTable.scheduledAt,
            publishedAt: schema.changelogTable.publishedAt,
            organizationId: schema.changelogTable.organizationId,
            creatorMemberId: schema.changelogTable.creatorMemberId,
            creatorId: schema.changelogTable.creatorId,
            createdAt: schema.changelogTable.createdAt,
            updatedAt: schema.changelogTable.updatedAt,
            user: {
              name: sql<string | null>`${schema.userTable.name}`,
              image: sql<string | null>`${schema.userTable.image}`,
            },
          })
          .from(schema.changelogTable)
          .leftJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.changelogTable.creatorId)
          )
          .where(eq(schema.changelogTable.organizationId, organizationId));
      }),

    findManyPublished: ({ organizationId }: TChangelogList) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({
            id: schema.changelogTable.id,
            title: schema.changelogTable.title,
            slug: schema.changelogTable.slug,
            content: schema.changelogTable.content,
            status: schema.changelogTable.status,
            scheduledAt: schema.changelogTable.scheduledAt,
            publishedAt: schema.changelogTable.publishedAt,
            organizationId: schema.changelogTable.organizationId,
            creatorMemberId: schema.changelogTable.creatorMemberId,
            creatorId: schema.changelogTable.creatorId,
            createdAt: schema.changelogTable.createdAt,
            updatedAt: schema.changelogTable.updatedAt,
            user: {
              name: sql<string | null>`${schema.userTable.name}`,
              image: sql<string | null>`${schema.userTable.image}`,
            },
          })
          .from(schema.changelogTable)
          .leftJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.changelogTable.creatorId)
          )
          .where(
            and(
              eq(schema.changelogTable.organizationId, organizationId),
              eq(schema.changelogTable.status, "published")
            )
          );
      }),

    create: ({
      id,
      title,
      slug,
      content,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
      creatorId,
      creatorMemberId,
    }: TChangelogCreateInternal) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db.insert(schema.changelogTable).values({
          id,
          title,
          slug: slug || slugify(title),
          content,
          status,
          scheduledAt,
          publishedAt,
          organizationId,
          creatorId,
          ...(creatorMemberId ? { creatorMemberId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }).pipe(Effect.asVoid),

    update: ({
      id,
      title,
      slug,
      content,
      status,
      scheduledAt,
      publishedAt,
      organizationId,
    }: TChangelogUpdate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.changelogTable)
          .set({
            title,
            slug: slug || slugify(title),
            content,
            status,
            scheduledAt,
            publishedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.changelogTable.id, id),
              eq(schema.changelogTable.organizationId, organizationId)
            )
          );
      }).pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TChangelogDelete) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db.delete(schema.changelogTable).where(
          and(
            eq(schema.changelogTable.id, id),
            eq(schema.changelogTable.organizationId, organizationId)
          )
        );
      }).pipe(Effect.asVoid),
  };
});

export class ChangelogRepository extends Context.Service<ChangelogRepository>()(
  "ChangelogRepository",
  {
    make: makeChangelogRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}