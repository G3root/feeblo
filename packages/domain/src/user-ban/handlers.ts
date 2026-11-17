import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import {
  InternalServerError,
  NotFoundError,
  BadRequestError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { UserBanDataError } from "./errors";
import { UserBanRepository, type UserBanStoredRow } from "./repository";
import { UserBanRpcs } from "./rpcs";
import type {
  UserBanCreate,
  UserBanListRequest,
  UserBanRemove,
  UserBanStatusRequest,
  UserBanSummary,
} from "./schema";

/** The role gate: manager and above, inherited through the permission table. */
const canManage = (organizationId: string) =>
  Policy.canPermission(organizationId, "userBans.manage");

const toSummary = (
  row: UserBanStoredRow,
  names: {
    readonly userName: string | null;
    readonly createdByName: string | null;
  }
): UserBanSummary => ({
  id: row.id,
  userId: row.userId,
  email: row.email,
  userName: names.userName,
  reason: row.reason,
  createdAt: row.createdAt,
  createdByName: names.createdByName,
});

/**
 * Folds a stored-row failure into the response the client can act on.
 *
 * `catchIf` rather than a tag-specific catch: the effect also carries the
 * handler's own `BadRequest`/`NotFound`/`PolicyDenied` failures, and only the
 * repository's `UserBanDataError` should become a 500. The predicate
 * narrows the channel without depending on the repository's inferred driver
 * error type.
 */
const remapDataError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchIf(effect, Schema.is(UserBanDataError), (error) =>
    Effect.fail(new InternalServerError({ message: error.reason }))
  );

export const UserBanRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UserBanRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  return {
    ListUserBans: (args: UserBanListRequest) =>
      repository.list(args).pipe(
        Effect.map((result) => ({
          items: result.items.map((row) =>
            toSummary(row, {
              createdByName: row.createdByName,
              userName: row.userName,
            })
          ),
          total: result.total,
        })),
        Policy.withPolicy(canManage(args.organizationId)),
        withRemapDbErrors("UserBan", "select")
      ),

    BanUser: (args: UserBanCreate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const audit = yield* AuditLogRecorder;
        const now = yield* DateTime.nowAsDate;

        const resolved = yield* repository.resolveTarget({
          organizationId: args.organizationId,
          target: args.target,
        });

        if (resolved.status === "not_found") {
          return yield* new NotFoundError({
            message: "The person to ban was not found",
          });
        }

        if (resolved.status === "member") {
          return yield* new BadRequestError({
            message:
              "Workspace members are managed through membership, not banned",
          });
        }

        if (resolved.status === "unresolvable") {
          return yield* new BadRequestError({
            message: "This customer has no account or email address to ban",
          });
        }

        // The ban row and the participation it removes land together: a
        // purge that fails must not leave the person banned with their history
        // intact, and a ban that fails must not delete anything. Both halves
        // are database work, so the transaction retry (ADR 0020) can replay
        // them.
        const { row, purged } = yield* transaction(
          Effect.gen(function* () {
            const row = yield* repository.upsert({
              createdByMemberId: membership?.membershipId ?? null,
              email: resolved.email,
              now,
              organizationId: args.organizationId,
              reason: args.reason ?? null,
              userId: resolved.userId,
            });

            // A ban always strips what would otherwise keep the person inside
            // a workspace they may no longer write in: their votes and every
            // follow or email subscription. An address-only ban has no
            // account, so there is nothing to strip.
            if (resolved.userId !== null) {
              yield* repository.clearVotesAndSubscriptions({
                email: resolved.email,
                now,
                organizationId: args.organizationId,
                userId: resolved.userId,
              });
            }

            // An address-only ban has no account, so it has no authored
            // content to remove; the checkbox is simply a no-op there.
            const purged =
              args.deleteContent === true && resolved.userId !== null
                ? yield* repository.purgeContent({
                    organizationId: args.organizationId,
                    userId: resolved.userId,
                  })
                : { comments: 0, posts: 0 };

            // In the ban's transaction, so the entry and the ban commit
            // together. The banned person is the subject of the record, not
            // the operator: an address-only ban has no account, so there is
            // no `affectedUserId` to pass.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "user_ban.created",
              ...(resolved.userId !== null && {
                affectedUserId: resolved.userId,
              }),
              // The address stays in the ban row, which is mutable and
              // deleted with the ban. The entry is append-only, so it carries
              // the subject's id and the shape of the action instead: a copy of
              // the address here would outlive every mechanism that removes it.
              metadata: {
                deletedComments: purged.comments,
                deletedPosts: purged.posts,
                reason: args.reason ?? null,
              },
            });

            return { purged, row };
          })
        );

        return {
          ban: toSummary(row, {
            createdByName: session.user.name,
            userName: resolved.name,
          }),
          deletedComments: purged.comments,
          deletedPosts: purged.posts,
        };
      }).pipe(
        remapDataError,
        Policy.withPolicy(canManage(args.organizationId)),
        Policy.withPolicy(
          entitlementPolicy.canManageUserBans(args.organizationId)
        ),
        withRemapDbErrors("UserBan", "create")
      ),

    UnbanUser: (args: UserBanRemove) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;

        const result = yield* transaction(
          Effect.gen(function* () {
            if (args._tag === "row") {
              const removed = yield* repository.remove(args);

              // Only a delete that matched a row is an event; a stale id is
              // reported as NotFound below and leaves the log alone. The row
              // names the ban, not the person it was made against, so this
              // branch has no affected user to pass without a second read.
              if (removed.removed) {
                yield* audit.record({
                  organizationId: args.organizationId,
                  actor: actorFromSession(session, args.organizationId),
                  source: "dashboard",
                  action: "user_ban.removed",
                  resourceId: args.id,
                });
              }

              return removed;
            }

            const resolved = yield* repository.resolveTarget({
              organizationId: args.organizationId,
              target: args.target,
            });

            // `member` and `not_found` both leave nothing to remove. A member
            // cannot be banned, so a row naming one predates their membership
            // and has no effect; the settings list names that row directly and
            // can still clear it.
            if (resolved.status !== "ok") {
              return { removed: false };
            }

            const removed = yield* repository.removeByFacets({
              email: resolved.email,
              organizationId: args.organizationId,
              userId: resolved.userId,
            });

            if (removed.removed) {
              // This branch resolved the person it is lifting the ban from, so
              // the affected user is known here where the row-id branch's is
              // not.
              yield* audit.record({
                organizationId: args.organizationId,
                actor: actorFromSession(session, args.organizationId),
                source: "dashboard",
                action: "user_ban.removed",
                ...(resolved.userId !== null && {
                  affectedUserId: resolved.userId,
                }),
                // No address, for the reason given on the ban entry.
                metadata: {},
              });
            }

            return removed;
          })
        );

        if (!result.removed) {
          return yield* new NotFoundError({ message: "Ban not found" });
        }
      }).pipe(
        remapDataError,
        Policy.withPolicy(canManage(args.organizationId)),
        withRemapDbErrors("UserBan", "delete")
      ),

    GetUserBanStatus: (args: UserBanStatusRequest) =>
      Effect.gen(function* () {
        const session = yield* OptionalCurrentSession;

        if (Option.isNone(session)) {
          return { banned: false };
        }

        if (Policy.isMember(session.value, args.organizationId)) {
          return { banned: false };
        }

        const banned = yield* repository.isBanned({
          email: session.value.user.email,
          organizationId: args.organizationId,
          userId: session.value.session.userId,
        });

        return { banned };
      }).pipe(withRemapDbErrors("UserBan", "select")),
  };
});

export const UserBanRpcHandlers = UserBanRpcs.toLayer(
  UserBanRpcHandlersEffect
).pipe(
  Layer.provide(UserBanRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  ),
  Layer.provide(AuditLogRecorder.layer)
);
