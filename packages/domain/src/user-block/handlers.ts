import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import {
  InternalServerError,
  NotFoundError,
  BadRequestError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { UserBlockDataError } from "./errors";
import { UserBlockRepository, type UserBlockStoredRow } from "./repository";
import { UserBlockRpcs } from "./rpcs";
import type {
  UserBlockCreate,
  UserBlockListRequest,
  UserBlockRemove,
  UserBlockStatusRequest,
  UserBlockSummary,
} from "./schema";

/** The role gate: manager and above, inherited through the permission table. */
const canManage = (organizationId: string) =>
  Policy.canPermission(organizationId, "userBlocks.manage");

const toSummary = (
  row: UserBlockStoredRow,
  names: {
    readonly userName: string | null;
    readonly createdByName: string | null;
  }
): UserBlockSummary => ({
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
 * repository's `UserBlockDataError` should become a 500. The predicate
 * narrows the channel without depending on the repository's inferred driver
 * error type.
 */
const remapDataError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchIf(effect, Schema.is(UserBlockDataError), (error) =>
    Effect.fail(new InternalServerError({ message: error.reason }))
  );

export const UserBlockRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UserBlockRepository;

  return {
    ListUserBlocks: (args: UserBlockListRequest) =>
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
        withRemapDbErrors("UserBlock", "select")
      ),

    BlockUser: (args: UserBlockCreate) =>
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
            message: "The person to block was not found",
          });
        }
        if (resolved.status === "member") {
          return yield* new BadRequestError({
            message:
              "Workspace members are managed through membership, not blocked",
          });
        }
        if (resolved.status === "unresolvable") {
          return yield* new BadRequestError({
            message: "This customer has no account or email address to block",
          });
        }

        const row = yield* repository.upsert({
          createdByMemberId: membership?.membershipId ?? null,
          email: resolved.email,
          now,
          organizationId: args.organizationId,
          reason: args.reason ?? null,
          userId: resolved.userId,
        });

        return toSummary(row, {
          createdByName: session.user.name,
          userName: resolved.name,
        });
      }).pipe(
        remapDataError,
        Policy.withPolicy(canManage(args.organizationId)),
        withRemapDbErrors("UserBlock", "create")
      ),

    UnblockUser: (args: UserBlockRemove) =>
      repository.remove(args).pipe(
        Effect.flatMap((result) =>
          result.removed
            ? Effect.void
            : Effect.fail(new NotFoundError({ message: "Block not found" }))
        ),
        Policy.withPolicy(canManage(args.organizationId)),
        withRemapDbErrors("UserBlock", "delete")
      ),

    GetUserBlockStatus: (args: UserBlockStatusRequest) =>
      Effect.gen(function* () {
        const session = yield* OptionalCurrentSession;
        if (Option.isNone(session)) {
          return { blocked: false };
        }
        if (Policy.isMember(session.value, args.organizationId)) {
          return { blocked: false };
        }
        const blocked = yield* repository.isBlocked({
          email: session.value.user.email,
          organizationId: args.organizationId,
          userId: session.value.session.userId,
        });
        return { blocked };
      }).pipe(withRemapDbErrors("UserBlock", "select")),
  };
});

export const UserBlockRpcHandlers = UserBlockRpcs.toLayer(
  UserBlockRpcHandlersEffect
).pipe(Layer.provide(UserBlockRepository.layer));
