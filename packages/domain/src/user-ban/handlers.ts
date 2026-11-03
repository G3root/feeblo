import { transaction } from "@feeblo/db";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
      repository.remove(args).pipe(
        Effect.flatMap((result) =>
          result.removed
            ? Effect.void
            : Effect.fail(new NotFoundError({ message: "Ban not found" }))
        ),
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
  )
);
