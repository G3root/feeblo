import { Effect, Layer } from "effect";
import {
  isMemberOfOrganization,
  requireOrganizationMembership,
} from "../authorization";
import {
  InternalServerError,
  mapToInternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { CommentRepository } from "./repository";
import { CommentRpcs } from "./rpcs";
import type {
  TCommentCreate,
  TCommentDelete,
  TCommentList,
  TCommentUpdate,
} from "./schema";

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
      CommentListPublic: (args: TCommentList) => {
        return Effect.gen(function* () {
          return yield* repository.findMany({
            organizationId: args.organizationId,
            postId: args.postId,
            visibility: "PUBLIC",
          });
        }).pipe(Effect.mapError(mapToInternalServerError()));
      },
      CommentCreate: (args: TCommentCreate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;

          const isMember = yield* isMemberOfOrganization(args.organizationId);

          const createdComment = yield* repository.create({
            ...args,
            userId: session.session.userId,
            ...(isMember ? { memberId: isMember.id } : {}),
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
      CommentDelete: (args: TCommentDelete) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          yield* requireOrganizationMembership(args.organizationId);

          yield* repository.delete({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });
          return {
            message: "Comment deleted successfully",
          };
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
      CommentUpdate: (args: TCommentUpdate) => {
        return Effect.gen(function* () {
          yield* requireOrganizationMembership(args.organizationId);
          const session = yield* CurrentSession;
          yield* repository.update({
            id: args.id,
            organizationId: args.organizationId,
            postId: args.postId,
            content: args.content,
            userId: session.session.userId,
          });
          return {
            message: "Comment updated successfully",
          };
        }).pipe(Effect.mapError(mapToInternalServerError(UnauthorizedError)));
      },
    };
  })
).pipe(Layer.provide(CommentRepository.Default));
