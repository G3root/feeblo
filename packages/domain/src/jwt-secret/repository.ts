import { randomBytes } from "node:crypto";
import { currentDb, schema } from "@feeblo/db";
import { JwtSecretId } from "@feeblo/id";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TJwtSecretGetOrCreate {
  organizationId: string;
}

interface TJwtSecretRevoke {
  organizationId: string;
  secretId: string;
}

interface TJwtSecretRotate {
  organizationId: string;
}

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

const makeJwtSecretRepository = Effect.gen(function* () {
  return {
    getSecretsForOrg: ({ organizationId }: TJwtSecretGetOrCreate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const now = yield* DateTime.nowAsDate;

        yield* db
          .delete(schema.jwtSecretTable)
          .where(
            and(
              eq(schema.jwtSecretTable.organizationId, organizationId),
              lt(schema.jwtSecretTable.revokedAt, now)
            )
          );

        const existing = yield* db
          .select()
          .from(schema.jwtSecretTable)
          .where(eq(schema.jwtSecretTable.organizationId, organizationId))
          .orderBy(desc(schema.jwtSecretTable.createdAt));

        const active = existing.find((s) => s.revokedAt === null);

        if (!active) {
          const revoked = existing.filter((s) => s.revokedAt !== null);
          if (revoked.length > 1) {
            yield* db.delete(schema.jwtSecretTable).where(
              inArray(
                schema.jwtSecretTable.id,
                revoked.slice(1).map((s) => s.id)
              )
            );
          }

          const id = yield* JwtSecretId.generate;
          const secret = generateSecret();
          const now = yield* DateTime.nowAsDate;

          const [created] = yield* db
            .insert(schema.jwtSecretTable)
            .values({
              id,
              organizationId,
              secret,
              createdAt: now,
              revokedAt: null,
            })
            .returning();

          return [created!, ...revoked.slice(0, 1)];
        }

        const revoked = existing.filter((s) => s.revokedAt !== null);
        if (revoked.length > 1) {
          yield* db.delete(schema.jwtSecretTable).where(
            inArray(
              schema.jwtSecretTable.id,
              revoked.slice(1).map((s) => s.id)
            )
          );
          return [active!, revoked[0]!];
        }

        return existing;
      }),
    revoke: ({ organizationId, secretId }: TJwtSecretRevoke) =>
      Effect.gen(function* () {
        const db = yield* currentDb;

        yield* db
          .delete(schema.jwtSecretTable)
          .where(
            and(
              eq(schema.jwtSecretTable.id, secretId),
              eq(schema.jwtSecretTable.organizationId, organizationId)
            )
          );

        const secret = generateSecret();
        const id = yield* JwtSecretId.generate;
        const now = yield* DateTime.nowAsDate;

        yield* db.insert(schema.jwtSecretTable).values({
          id,
          organizationId,
          secret,
          createdAt: now,
          revokedAt: null,
        });
      }).pipe(Effect.asVoid),
    rotate: ({ organizationId }: TJwtSecretRotate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        const nowUtc = yield* DateTime.now;
        const gracePeriod = DateTime.toDate(
          DateTime.addDuration(nowUtc, Duration.hours(24))
        );

        yield* db
          .update(schema.jwtSecretTable)
          .set({
            revokedAt: gracePeriod,
          })
          .where(
            and(
              eq(schema.jwtSecretTable.organizationId, organizationId),
              isNull(schema.jwtSecretTable.revokedAt)
            )
          );

        const id = yield* JwtSecretId.generate;
        const secret = generateSecret();
        const now = yield* DateTime.nowAsDate;

        yield* db.insert(schema.jwtSecretTable).values({
          id,
          organizationId,
          secret,
          createdAt: now,
          revokedAt: null,
        });

        return {
          id,
          secret,
          organizationId,
          createdAt: now,
          revokedAt: null as Date | null,
        };
      }),
  };
});

export class JwtSecretRepository extends Context.Service<JwtSecretRepository>()(
  "JwtSecretRepository",
  {
    make: makeJwtSecretRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
