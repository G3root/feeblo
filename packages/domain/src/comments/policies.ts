import { Effect, Option } from "effect";
import { CommentRepository } from "./repository";

type TIsOwner = {
  organizationId: string;
  commentId: string;
  postId: string;
};

export class CommentPolicy extends Effect.Service<CommentPolicy>()(
  "CommentPolicy",
  {
    effect: Effect.gen(function* () {
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
    }),
    dependencies: [CommentRepository.Default],
  }
) {}
