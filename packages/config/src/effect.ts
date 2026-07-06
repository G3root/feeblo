import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Effect.map((value) =>
      Option.isSome(value) && value.value.trim() !== "" ? value : Option.none()
    )
  );
