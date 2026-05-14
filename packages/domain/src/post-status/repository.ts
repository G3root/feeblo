import { Database, schema } from "@feeblo/db";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

interface TFindMany {
  organizationId: string;
}

const makePostStatusRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findMany: ({ organizationId }: TFindMany) =>
      Effect.gen(function* () {
        const postStatuses = yield* db.makeQuery((execute, input: TFindMany) =>
          execute((client) =>
            client
              .select({
                id: schema.postStatusTable.id,
                type: schema.postStatusTable.type,
                orderIndex: schema.postStatusTable.orderIndex,
                organizationId: schema.postStatusTable.organizationId,
                createdAt: schema.postStatusTable.createdAt,
                updatedAt: schema.postStatusTable.updatedAt,
              })
              .from(schema.postStatusTable)
              .where(
                eq(schema.postStatusTable.organizationId, input.organizationId)
              )
              .orderBy(asc(schema.postStatusTable.orderIndex))
          )
        )({ organizationId });

        return postStatuses;
      }),
  };
});

export class PostStatusRepository extends Context.Service<PostStatusRepository>()(
  "PostStatusRepository",
  {
    make: makePostStatusRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
