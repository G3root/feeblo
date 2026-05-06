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

type TChangelogCreateInternal = TChangelogCreate & {
  creatorId: string;
  creatorMemberId?: string;
};

type TFindByCreatorId = {
  id: string;
  organizationId: string;
  memberId: string;
};

const makeChangelogRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findByCreatorId: ({ id, organizationId, memberId }: TFindByCreatorId) =>
      db
        .makeQuery((execute, input: TFindByCreatorId) =>
          execute((client) =>
            client
              .select({ id: schema.changelog.id })
              .from(schema.changelog)
              .where(
                and(
                  eq(schema.changelog.id, input.id),
                  eq(schema.changelog.organizationId, input.organizationId),
                  eq(schema.changelog.creatorMemberId, input.memberId)
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
              id: schema.changelog.id,
              title: schema.changelog.title,
              slug: schema.changelog.slug,
              content: schema.changelog.content,
              status: schema.changelog.status,
              scheduledAt: schema.changelog.scheduledAt,
              publishedAt: schema.changelog.publishedAt,
              organizationId: schema.changelog.organizationId,
              creatorMemberId: schema.changelog.creatorMemberId,
              creatorId: schema.changelog.creatorId,
              createdAt: schema.changelog.createdAt,
              updatedAt: schema.changelog.updatedAt,
              user: {
                name: sql<string | null>`${schema.user.name}`,
                image: sql<string | null>`${schema.user.image}`,
              },
            })
            .from(schema.changelog)
            .leftJoin(
              schema.user,
              eq(schema.user.id, schema.changelog.creatorId)
            )
            .where(eq(schema.changelog.organizationId, input.organizationId))
        )
      )({ organizationId }),

    findManyPublished: ({ organizationId }: TChangelogList) =>
      db.makeQuery((execute, input: TChangelogList) =>
        execute((client) =>
          client
            .select({
              id: schema.changelog.id,
              title: schema.changelog.title,
              slug: schema.changelog.slug,
              content: schema.changelog.content,
              status: schema.changelog.status,
              scheduledAt: schema.changelog.scheduledAt,
              publishedAt: schema.changelog.publishedAt,
              organizationId: schema.changelog.organizationId,
              creatorMemberId: schema.changelog.creatorMemberId,
              creatorId: schema.changelog.creatorId,
              createdAt: schema.changelog.createdAt,
              updatedAt: schema.changelog.updatedAt,
              user: {
                name: sql<string | null>`${schema.user.name}`,
                image: sql<string | null>`${schema.user.image}`,
              },
            })
            .from(schema.changelog)
            .leftJoin(
              schema.user,
              eq(schema.user.id, schema.changelog.creatorId)
            )
            .where(
              and(
                eq(schema.changelog.organizationId, input.organizationId),
                eq(schema.changelog.status, "published")
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
            client.insert(schema.changelog).values({
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
              .update(schema.changelog)
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
                  eq(schema.changelog.id, input.id),
                  eq(schema.changelog.organizationId, input.organizationId)
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
              .delete(schema.changelog)
              .where(
                and(
                  eq(schema.changelog.id, input.id),
                  eq(schema.changelog.organizationId, input.organizationId)
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
