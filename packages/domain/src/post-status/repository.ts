import { currentDb, schema } from "@feeblo/db";
import { asc, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TFindMany {
  organizationId: string;
}

const makePostStatusRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findMany: ({ organizationId }: TFindMany) =>
      db
        .select({
          id: schema.postStatusTable.id,
          type: schema.postStatusTable.type,
          orderIndex: schema.postStatusTable.orderIndex,
          organizationId: schema.postStatusTable.organizationId,
          createdAt: schema.postStatusTable.createdAt,
          updatedAt: schema.postStatusTable.updatedAt,
        })
        .from(schema.postStatusTable)
        .where(eq(schema.postStatusTable.organizationId, organizationId))
        .orderBy(asc(schema.postStatusTable.orderIndex)),
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
