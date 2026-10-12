import { currentDb, schema } from "@feeblo/db";
import type {
  TNotificationPreferenceChannel,
  TNotificationPreferenceTarget,
} from "@feeblo/db/validation-schema/notification-preference";
import { NotificationPreferenceId } from "@feeblo/id";
import { and, eq, inArray } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

interface TRecipient {
  readonly organizationId: string;
  readonly userId: string;
}

interface TSetPreference extends TRecipient {
  readonly category: TNotificationPreferenceTarget;
  readonly channel: TNotificationPreferenceChannel;
  readonly enabled: boolean;
}

interface TDisabledForUsers {
  readonly channel: TNotificationPreferenceChannel;
  readonly organizationId: string;
  readonly userIds: readonly string[];
}

const makeNotificationPreferenceRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const preferenceTable = schema.notificationPreferenceTable;

  return {
    /**
     * Every stored row for one recipient in one workspace on the `email`
     * channel, disabling entries included. The caller resolves defaults.
     */
    listForRecipient: ({ organizationId, userId }: TRecipient) =>
      db
        .select({
          category: preferenceTable.category,
          enabled: preferenceTable.enabled,
        })
        .from(preferenceTable)
        .where(
          and(
            eq(preferenceTable.organizationId, organizationId),
            eq(preferenceTable.userId, userId),
            eq(preferenceTable.channel, "email")
          )
        ),

    /**
     * The disabling rows for a set of recipients, so a fan-out can filter
     * members without reading a row per user. `enabled: true` rows are never
     * stored (see `setPreference`), so this is the complete opt-out set.
     */
    listDisabledForUsers: ({
      channel,
      organizationId,
      userIds,
    }: TDisabledForUsers) =>
      userIds.length === 0
        ? Effect.succeed(
            // SAFETY: An empty user set has no disabling rows by definition.
            [] as readonly {
              readonly category: TNotificationPreferenceTarget;
              readonly userId: string;
            }[]
          )
        : db
            .select({
              category: preferenceTable.category,
              userId: preferenceTable.userId,
            })
            .from(preferenceTable)
            .where(
              and(
                eq(preferenceTable.organizationId, organizationId),
                inArray(preferenceTable.userId, [...userIds]),
                eq(preferenceTable.channel, channel),
                eq(preferenceTable.enabled, false)
              )
            ),

    /**
     * Writes one explicit divergence from the default.
     *
     * The table is sparse by construction: enabling deletes the row instead of
     * storing `true`, because the default is already on and "no row" must keep
     * exactly one meaning. Disabling upserts `enabled: false`, so toggling off
     * twice is idempotent.
     */
    setPreference: ({
      category,
      channel,
      enabled,
      organizationId,
      userId,
    }: TSetPreference) =>
      enabled
        ? db
            .delete(preferenceTable)
            .where(
              and(
                eq(preferenceTable.organizationId, organizationId),
                eq(preferenceTable.userId, userId),
                eq(preferenceTable.channel, channel),
                eq(preferenceTable.category, category)
              )
            )
            .pipe(Effect.asVoid)
        : Effect.gen(function* () {
            const id = yield* NotificationPreferenceId.generate;
            const now = yield* DateTime.nowAsDate;
            yield* db
              .insert(preferenceTable)
              .values({
                id,
                organizationId,
                userId,
                channel,
                category,
                enabled: false,
              })
              .onConflictDoUpdate({
                target: [
                  preferenceTable.organizationId,
                  preferenceTable.userId,
                  preferenceTable.channel,
                  preferenceTable.category,
                ],
                set: { enabled: false, updatedAt: now },
              })
              .pipe(Effect.asVoid);
          }),
  };
});

export class NotificationPreferenceRepository extends Context.Service<NotificationPreferenceRepository>()(
  "NotificationPreferenceRepository",
  {
    make: makeNotificationPreferenceRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
