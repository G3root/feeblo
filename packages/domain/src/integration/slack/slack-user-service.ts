import { currentDb, type Database, schema } from "@feeblo/db";
import { UserId } from "@feeblo/id";
import {
  makeSlackApiClient,
  type SlackApiClient,
} from "@feeblo/integration-slack";
import { truncate } from "@feeblo/utils/text";
import { and, eq, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { SlackInboundFailure } from "./errors";

const SYNTHETIC_SLACK_EMAIL_SUFFIX = "@slack.invalid";

/**
 * Resolves a Slack identity to a Feeblo user, creating an anonymous user when
 * no existing account matches. Owns the three-step resolution policy: SSO-style
 * email linking, stable synthetic-email reuse, and anonymous-user creation.
 */
export interface SlackUserServiceContract {
  readonly resolveUser: (input: {
    readonly botToken: Redacted.Redacted<string>;
    readonly organizationId: string;
    readonly slackTeamId: string;
    readonly slackUserId: string;
  }) => Effect.Effect<string, SlackInboundFailure>;
}

export class SlackUserService extends Context.Service<
  SlackUserService,
  SlackUserServiceContract
>()("@feeblo/SlackUserService") {}

/** Creates the Slack user resolution service with an injectable API client. */
export const makeSlackUserServiceLive = (
  apiClient: SlackApiClient = makeSlackApiClient()
): Layer.Layer<SlackUserService, never, Database.Database> =>
  Layer.effect(
    SlackUserService,
    Effect.gen(function* () {
      const db = yield* currentDb;

      const resolveUser = ({
        botToken,
        organizationId,
        slackTeamId,
        slackUserId,
      }: {
        readonly botToken: Redacted.Redacted<string>;
        readonly organizationId: string;
        readonly slackTeamId: string;
        readonly slackUserId: string;
      }) =>
        Effect.gen(function* () {
          // Fetch the Slack profile best-effort; fall back to the username
          // when the profile lookup fails.
          const profile = yield* Effect.exit(
            apiClient.usersInfo({ botToken, userId: slackUserId })
          );
          const displayName = Exit.isSuccess(profile)
            ? (profile.value.user.real_name ??
              profile.value.user.profile?.display_name ??
              profile.value.user.profile?.real_name ??
              profile.value.user.name ??
              slackUserId)
            : slackUserId;
          const email = Exit.isSuccess(profile)
            ? profile.value.user.profile?.email
            : undefined;
          // 1. SSO-style linking: a visible email that matches an existing
          // Feeblo user of this organization reuses that account, so Slack
          // feedback lands on the person's real profile. Matching is scoped
          // to users of this organization (SSO users are restricted to it;
          // members hold a membership row).
          if (email !== undefined) {
            const [match] = yield* db
              .select({ id: schema.userTable.id })
              .from(schema.userTable)
              .where(
                and(
                  eq(schema.userTable.email, email),
                  or(
                    eq(
                      schema.userTable.restrictedToOrganizationId,
                      organizationId
                    ),
                    sql`EXISTS (
                      SELECT 1 FROM ${schema.memberTable}
                      WHERE ${schema.memberTable.userId} = ${schema.userTable.id}
                        AND ${schema.memberTable.organizationId} = ${organizationId}
                    )`
                  )
                )
              )
              .limit(1);
            if (match !== undefined) {
              return match.id;
            }
          }
          // 2. Stable anonymous identity: the synthetic email derived from the
          // team + slack user id maps every future submission back to the same
          // user, without a dedicated link table. Team-scoped so the same
          // slack id in two workspaces can never collide.
          const syntheticEmail = `slack-${slackTeamId.toLowerCase()}-${slackUserId.toLowerCase()}${SYNTHETIC_SLACK_EMAIL_SUFFIX}`;
          const [existing] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          if (existing !== undefined) {
            return existing.id;
          }
          // 3. Create the anonymous user. These users never receive
          // transactional email (synthetic address, emailVerified false).
          const userId = yield* UserId.generate;
          yield* db
            .insert(schema.userTable)
            .values({
              email: syntheticEmail,
              emailVerified: false,
              id: userId,
              name: truncate(displayName, 100),
            })
            .pipe(Effect.ignore);
          // Concurrent submissions may create the same user; the insert
          // conflict is ignored and the winner is reused.
          const [winner] = yield* db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(eq(schema.userTable.email, syntheticEmail))
            .limit(1);
          return winner?.id ?? userId;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof SlackInboundFailure
              ? error
              : new SlackInboundFailure({
                  message: "Could not resolve Slack user",
                })
          )
        );

      return SlackUserService.of({ resolveUser });
    })
  );

/** Live layer with the default fetch-backed Slack API client. */
export const SlackUserServiceLive = makeSlackUserServiceLive();
