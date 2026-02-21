import { DB } from "@feeblo/db";
import { post as postTable } from "@feeblo/db/schema/feedback";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Post } from "./schema";

export class PostRepository extends Effect.Service<PostRepository>()(
  "PostRepository",
  {
    effect: Effect.gen(function* () {
      const db = yield* DB;

      return {
        findMany: db
          .select({
            id: postTable.id,
          })
          .from(postTable)
          .pipe(
            Effect.map((posts) =>
              posts.map((entry) => new Post({ id: entry.id }))
            )
          ),
        findById: (id: string) =>
          db
            .select({
              id: postTable.id,
            })
            .from(postTable)
            .where(eq(postTable.id, id))
            .limit(1)
            .pipe(
              Effect.andThen((posts) => {
                const post = posts[0];
                return post
                  ? Effect.succeed(new Post({ id: post.id }))
                  : Effect.fail(`Post not found: ${id}`);
              })
            ),
        delete: (id: string) =>
          db
            .delete(postTable)
            .where(and(eq(postTable.id, id)))
            .pipe(Effect.asVoid),
      };
    }),
  }
) {}
