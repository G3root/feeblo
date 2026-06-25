import { Context, Effect, Layer, Option } from "effect";
import * as Policy from "../policy";
import { CommentRepository } from "./repository";

type TIsOwner = {
  organizationId: string;
  commentId: string;
  postId: string;
};

type TCanCreate = {
  organizationId: string;
  visibility: "PUBLIC" | "INTERNAL";
};

const makeCommentPolicy = Effect.gen(function* () {
  const repository = yield* CommentRepository;

  const canCreate = (args: TCanCreate) =>
    Policy.policy((user) =>
      Effect.succeed(
        args.visibility === "PUBLIC" ||
          user.memberships.some(
            (membership) => membership.organizationId === args.organizationId
          )
      )
    );

  const isOwner = (args: TIsOwner) =>
    Policy.policy((user) =>
      repository
        .findById({
          id: args.commentId,
          organizationId: args.organizationId,
          postId: args.postId,
          userId: user.session.userId,
        })
        .pipe(Effect.map(Option.isSome))
    );

  return {
    canCreate,
    isOwner,
  };
});

export class CommentPolicy extends Context.Service<CommentPolicy>()(
  "CommentPolicy",
  {
    make: makeCommentPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
