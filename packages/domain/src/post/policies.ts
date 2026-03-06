import { Effect, Option, pipe, Schema } from "effect";
import * as Policy from "../policy";
import { PostRepository } from "./repository";
import { PostIds } from "./schema";

type TIsCreator = {
  organizationId: string;
  postId: string | readonly string[];
  boardId: string;
};

export class PostPolicy extends Effect.Service<PostPolicy>()("PostPolicy", {
  effect: Effect.gen(function* () {
    const repository = yield* PostRepository;

    const isCreator = (args: TIsCreator) =>
      Policy.policy((user) =>
        Option.fromNullable(
          user.memberships.find((m) => m.organizationId === args.organizationId)
        ).pipe(
          Option.match({
            onNone: () => Effect.succeed(false),
            onSome: (membership) =>
              pipe(args.postId, (postId) =>
                Schema.is(PostIds)(postId)
                  ? repository
                      .findByCreatorIds({
                        ids: postId,
                        organizationId: args.organizationId,
                        memberId: membership.membershipId,
                        boardId: args.boardId,
                      })
                      .pipe(
                        Effect.map((posts) => posts.length === postId.length)
                      )
                  : repository
                      .findByCreatorId({
                        id: postId,
                        organizationId: args.organizationId,
                        memberId: membership.membershipId,
                        boardId: args.boardId,
                      })
                      .pipe(Effect.map(Option.isSome))
              ),
          })
        )
      );

    const isOwner = (args: TIsCreator) =>
      Policy.any(
        Policy.hasRole("owner"),
        Policy.hasRole("admin"),
        isCreator(args)
      );

    return { isOwner, isCreator };
  }),
  dependencies: [PostRepository.Default],
}) {}
