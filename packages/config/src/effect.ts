import { Config, Effect, Option } from "effect";

export const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Effect.map((value) =>
      Option.isSome(value) && value.value.trim() !== "" ? value : Option.none()
    )
  );
