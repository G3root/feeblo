import { Effect, Ref } from "effect";
import { User } from "./schema";

export class UserRepository extends Effect.Service<UserRepository>()(
  "UserRepository",
  {
    effect: Effect.gen(function* () {
      const ref = yield* Ref.make<User[]>([
        new User({ id: "1", name: "Alice" }),
        new User({ id: "2", name: "Bob" }),
      ]);

      return {
        findMany: ref.get,
        findById: (id: string) =>
          Ref.get(ref).pipe(
            Effect.andThen((users) => {
              const user = users.find((entry) => entry.id === id);
              return user
                ? Effect.succeed(user)
                : Effect.fail(`User not found: ${id}`);
            })
          ),
        create: (name: string) =>
          Ref.modify(ref, (users) => {
            const created = new User({ id: String(users.length + 1), name });
            return [created, [...users, created]];
          }),
      };
    }),
  }
) {}
