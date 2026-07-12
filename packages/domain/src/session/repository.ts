import { randomBytes } from "node:crypto";
import { currentDb, schema } from "@feeblo/db";
import { SessionId } from "@feeblo/id";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

interface CreateSessionInput {
  userId: string;
}

const makeSessionRepository = Effect.succeed({
  createSession: (args: CreateSessionInput) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      const id = yield* SessionId.generate;

      const nowUtc = yield* DateTime.now;
      const now = yield* DateTime.nowAsDate;

      const expiresAt = DateTime.toDate(
        DateTime.addDuration(nowUtc, Duration.days(7))
      );

      const token = generateSessionToken();

      const [created = null] = yield* db
        .insert(schema.sessionTable)
        .values({
          id,
          userId: args.userId,
          token,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        return yield* Effect.die(
          new Error("Session insert did not return a row")
        );
      }
      return created;
    }),

  findByToken: (token: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const rows = yield* db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.token, token))
        .limit(1);
      return rows[0];
    }),
});

/**
 * @effect-expect-leaking Database
 */
export class SessionRepository extends Context.Service<SessionRepository>()(
  "SessionRepository",
  {
    make: makeSessionRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
