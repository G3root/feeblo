import type { Rpc } from "@effect/rpc";
import { Effect, Layer, Stream } from "effect";
import { UserRepository } from "./repository";
import { UserRpcs } from "./rpcs";

export const UserRpcHandlers: Layer.Layer<
  Rpc.Handler<"UserList"> | Rpc.Handler<"UserById"> | Rpc.Handler<"UserCreate">
> = UserRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* UserRepository;

    return {
      UserList: () => Stream.fromIterableEffect(repository.findMany),
      UserById: ({ id }) => repository.findById(id),
      UserCreate: ({ name }) => repository.create(name),
    };
  })
).pipe(Layer.provide(UserRepository.Default));
