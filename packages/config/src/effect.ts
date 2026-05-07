import { Config, Effect, Option } from "effect";

export const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    (config) => config.asEffect(),
    Effect.map((value) =>
      Option.isSome(value) && value.value.trim() !== "" ? value : Option.none()
    )
  );
