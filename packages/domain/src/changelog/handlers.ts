import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { onInternalServerError } from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";
import { CurrentSession } from "../session-middleware";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";
import { ChangelogRpcs } from "./rpcs";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

export const ChangelogRpcHandlers = ChangelogRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* ChangelogRepository;
    const changelogPolicy = yield* ChangelogPolicy;

    return {
      ChangelogList: (args: TChangelogList) =>
        repository.findMany(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchAll(onInternalServerError)
        ),

      ChangelogListPublic: (args: TChangelogList) =>
        repository.findManyPublished(args).pipe(
          Effect.catchAll(onInternalServerError)
        ),

      ChangelogCreate: (args: TChangelogCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = session.memberships.find(
            (membership) => membership.organizationId === args.organizationId
          );

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            creatorId: session.session.userId,
            ...(isMember ? { creatorMemberId: isMember.membershipId } : {}),
          });
        }).pipe(Effect.catchAll(onInternalServerError));
      },

      ChangelogDelete: (args: TChangelogDelete) =>
        repository.delete(args).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              changelogPolicy.isOwner({
                organizationId: args.organizationId,
                changelogId: args.id,
              })
            )
          ),
          Effect.catchAll(onInternalServerError)
        ),

      ChangelogUpdate: (args: TChangelogUpdate) =>
        repository
          .update({
            ...args,
            content: sanitizeRichText(args.content),
          })
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(args.organizationId),
                changelogPolicy.isOwner({
                  organizationId: args.organizationId,
                  changelogId: args.id,
                })
              )
            ),
            Effect.catchAll(onInternalServerError)
          ),
    };
  })
).pipe(
  Layer.provide(ChangelogPolicy.Default),
  Layer.provide(ChangelogRepository.Default)
);
