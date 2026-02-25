import { Effect, Layer } from "effect";
import { requireOrganizationMembership } from "../authorization";
import {
  InternalServerError,
  mapToInternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type { TCommentCreate, TCommentList } from "./schema";

export const CommentRpcHandlers = CommentRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* CommentRepository;

    return {
      CommentList: (args: TCommentList) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);

          return yield* repository.findMany({
            organizationId: args.organizationId,
            postId: args.postId,
          });
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      CommentCreate: (args: TCommentCreate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;

          const createdComment = yield* repository.create({
            ...args,
            userId: session.session.userId,
          });

          if (!createdComment) {
            return yield* Effect.fail(
              new InternalServerError({ message: "Failed to create comment" })
            );
          }

          return {
            message: "Comment created successfully",
          };
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
    };
  })
).pipe(Layer.provide(CommentRepository.Default));
