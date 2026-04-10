import { Effect, Option } from "effect";
import { CommentRepository } from "./repository";

type TIsOwner = {
  organizationId: string;
  commentId: string;
  postId: string;
};

const makeCommentPolicy = Effect.gen(function* () {
  const repository = yield* CommentRepository;

  const isOwner = (args: TIsOwner) => {
    return repository
      .findById({
        id: args.commentId,
        organizationId: args.organizationId,
        postId: args.postId,
      })
      .pipe(Effect.map(Option.isSome));
  };

  return {
    isOwner,
  };
});

export class CommentPolicy extends Effect.Service<CommentPolicy>()(
  "CommentPolicy",
  {
    effect: makeCommentPolicy,
    dependencies: [CommentRepository.Default],
  }
) {
  static readonly layer = this.Default;
}
