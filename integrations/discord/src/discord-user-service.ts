import { currentDb, type Database, schema } from "@feeblo/db";
import { DiscordInboundFailure } from "@feeblo/domain/integration/discord/errors";
import { isUniqueViolation } from "@feeblo/domain/rpc-errors";
import { UserId } from "@feeblo/id";
import { truncate } from "@feeblo/utils/text";
import { eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const SYNTHETIC_DISCORD_EMAIL_SUFFIX = "@discord.invalid";

/**
 * Resolves a Discord identity to a Feeblo user, creating an anonymous user
 * when no existing account matches.
 *
 * Unlike Slack, Discord never exposes the invoking user's email to the
 * integration, so the SSO-style email-linking step does not apply: the
 * resolution is the stable synthetic-email reuse and anonymous-user creation
 * pair from the Slack policy.
 */
export interface DiscordUserServiceContract {
  readonly resolveUser: (input: {
    readonly displayName: string;
    readonly guildId: string;
    readonly userId: string;
  }) => Effect.Effect<string, DiscordInboundFailure>;
}

export class DiscordUserService extends Context.Service<
  DiscordUserService,
  DiscordUserServiceContract
>()("@feeblo/DiscordUserService") {}

/** Creates the Discord user resolution service. */
export const makeDiscordUserServiceLive = (): Layer.Layer<
  DiscordUserService,
  never,
  Database.Database
> =>
  Layer.effect(
    DiscordUserService,
    Effect.gen(function* () {
      const db = yield* currentDb;

      const resolveUser = ({
        displayName,
        guildId,
        userId,
      }: {
        readonly displayName: string;
        readonly guildId: string;
        readonly userId: string;
      }) =>
        Effect.gen(function* () {
          // Stable anonymous identity: the synthetic email derived from the
          // guild + discord user id maps every future submission back to the
          // same user, without a dedicated link table. Guild-scoped so the
          // same discord id in two servers can never collide.
          const syntheticEmail = `discord-${guildId.toLowerCase()}-${userId.toLowerCase()}${SYNTHETIC_DISCORD_EMAIL_SUFFIX}`;
          const [existing] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          if (existing !== undefined) {
            return existing.id;
          }
          // Create the anonymous user. These users never receive transactional
          // email (synthetic address, emailVerified false).
          const createdUserId = yield* UserId.generate;
          yield* db
            .insert(schema.userTable)
            .values({
              email: syntheticEmail,
              emailVerified: false,
              id: createdUserId,
              name: truncate(displayName, 100),
            })
            .pipe(Effect.catchIf(isUniqueViolation, () => Effect.void));
          // Concurrent submissions may create the same user; the insert
          // conflict is ignored and the winner is reused.
          const [winner] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          if (winner === undefined) {
            return yield* new DiscordInboundFailure({
              message: "Could not resolve the created Discord user",
            });
          }
          return winner.id;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof DiscordInboundFailure
              ? error
              : new DiscordInboundFailure({
                  message: "Could not resolve Discord user",
                })
          )
        );

      return DiscordUserService.of({ resolveUser });
    })
  );

/** Live layer with real repositories and the default database context. */
export const DiscordUserServiceLive = makeDiscordUserServiceLive();
