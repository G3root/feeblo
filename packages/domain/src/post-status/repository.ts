import { DB } from "@feeblo/db";
import { postStatus as postStatusTable } from "@feeblo/db/schema/feedback";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

const makePostStatusRepository = Effect.gen(function* () {
  const db = yield* DB;

  return {
    findMany: ({ organizationId }: { organizationId: string }) =>
      Effect.gen(function* () {
        const postStatuses = yield* db
          .select({
            id: postStatusTable.id,
            type: postStatusTable.type,
            orderIndex: postStatusTable.orderIndex,
            organizationId: postStatusTable.organizationId,
            createdAt: postStatusTable.createdAt,
            updatedAt: postStatusTable.updatedAt,
          })
          .from(postStatusTable)
          .where(eq(postStatusTable.organizationId, organizationId))
          .orderBy(asc(postStatusTable.orderIndex));

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
