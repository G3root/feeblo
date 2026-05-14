import { Database, schema } from "@feeblo/db";
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
  const db = yield* Database.Database;

  return {
    findByCreatorId: ({ id, organizationId, memberId }: TFindByCreatorId) =>
      db
        .makeQuery((execute, input: TFindByCreatorId) =>
          execute((client) =>
            client
              .select({ id: schema.changelogTable.id })
              .from(schema.changelogTable)
              .where(
                and(
                  eq(schema.changelogTable.id, input.id),
                  eq(
                    schema.changelogTable.organizationId,
                    input.organizationId
                  ),
                  eq(schema.changelogTable.creatorMemberId, input.memberId)
                )
              )
          )
        )({ id, organizationId, memberId })
        .pipe(Effect.map(EffectArray.get(0))),

    findMany: ({ organizationId }: TChangelogList) =>
      db.makeQuery((execute, input: TChangelogList) =>
        execute((client) =>
          client
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
              eq(schema.changelogTable.organizationId, input.organizationId)
            )
        )
      )({ organizationId }),

    findManyPublished: ({ organizationId }: TChangelogList) =>
      db.makeQuery((execute, input: TChangelogList) =>
        execute((client) =>
          client
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
                eq(schema.changelogTable.organizationId, input.organizationId),
                eq(schema.changelogTable.status, "published")
              )
            )
        )
      )({ organizationId }),

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
      db
        .makeQuery((execute, input: TChangelogCreateInternal) =>
          execute((client) =>
            client.insert(schema.changelogTable).values({
              id: input.id,
              title: input.title,
              slug: input.slug || slugify(input.title),
              content: input.content,
              status: input.status,
              scheduledAt: input.scheduledAt,
              publishedAt: input.publishedAt,
              organizationId: input.organizationId,
              creatorId: input.creatorId,
              ...(input.creatorMemberId
                ? { creatorMemberId: input.creatorMemberId }
                : {}),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          )
        )({
          id,
          title,
          slug,
          content,
          status,
          scheduledAt,
          publishedAt,
          organizationId,
          creatorId,
          ...(creatorMemberId ? { creatorMemberId } : {}),
        })
        .pipe(Effect.asVoid),

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
      db
        .makeQuery((execute, input: TChangelogUpdate) =>
          execute((client) =>
            client
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
                  eq(schema.changelogTable.id, input.id),
                  eq(schema.changelogTable.organizationId, input.organizationId)
                )
              )
          )
        )({
          id,
          title,
          slug,
          content,
          status,
          scheduledAt,
          publishedAt,
          organizationId,
        })
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId }: TChangelogDelete) =>
      db
        .makeQuery((execute, input: TChangelogDelete) =>
          execute((client) =>
            client
              .delete(schema.changelogTable)
              .where(
                and(
                  eq(schema.changelogTable.id, input.id),
                  eq(schema.changelogTable.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.asVoid),
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
