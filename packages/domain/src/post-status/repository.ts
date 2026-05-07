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
                id: schema.postStatus.id,
                type: schema.postStatus.type,
                orderIndex: schema.postStatus.orderIndex,
                organizationId: schema.postStatus.organizationId,
                createdAt: schema.postStatus.createdAt,
                updatedAt: schema.postStatus.updatedAt,
              })
              .from(schema.postStatus)
              .where(eq(schema.postStatus.organizationId, input.organizationId))
              .orderBy(asc(schema.postStatus.orderIndex))
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
