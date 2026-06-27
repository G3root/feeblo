import { type Brand, Effect, Schema } from "effect";
import { createId, verifyId } from "legid";

const maxIdLength = 54;
const idRegex = /^[A-Za-z0-9]+$/;
const prefixRegex = /^[a-z]+$/;

export const LegidId = Schema.String.pipe(Schema.brand("LegidId"));
export type LegidId = typeof LegidId.Type;

export type LegidOf<Name extends string> = LegidId & Brand.Brand<Name>;

export class LegidError extends Schema.TaggedErrorClass<LegidError>()(
  "LegidError",
  {
    input: Schema.String,
    message: Schema.String,
  }
) {}

export interface LegidConfig {
  readonly approximateLength?: number;
  readonly salt?: string;
  readonly step?: number;
}

export interface LegidFactory<Name extends string> {
  readonly brand: Name;
  readonly generate: Effect.Effect<LegidOf<Name>, LegidError>;
  readonly verify: (input: string) => Effect.Effect<boolean>;
  readonly parse: (input: string) => Effect.Effect<LegidOf<Name>, LegidError>;
  readonly is: (input: string) => input is LegidOf<Name>;
  readonly unsafeGenerate: () => Promise<LegidOf<Name>>;
  readonly unsafeParse: (input: string) => Promise<LegidOf<Name>>;
}

export interface PrefixableLegidFactory<Name extends string>
  extends LegidFactory<Name> {
  readonly prefix: string;
}

export type LegidFrom<Factory> =
  Factory extends LegidFactory<infer Name> ? LegidOf<Name> : never;

type DefaultBrandName<Name extends string> =
  Name extends `${infer Head}_${infer Tail}`
    ? `${Capitalize<Head>}${DefaultBrandName<Tail>}`
    : `${Capitalize<Name>}Id`;

const fail = (input: string, message: string) =>
  Effect.fail(new LegidError({ input, message }));

const validateLegidFormat = (
  input: string
): Effect.Effect<string, LegidError> => {
  if (input.length === 0 || input.length > maxIdLength) {
    return fail(input, `Legid must be between 1 and ${maxIdLength} characters`);
  }

  if (!idRegex.test(input)) {
    return fail(
      input,
      "Legid must use only URL-safe characters (A-Z, a-z, 0-9)"
    );
  }

  return Effect.succeed(input);
};

const validateId = (input: string) =>
  Effect.map(validateLegidFormat(input), LegidId.make);

const validatePrefix = (prefix: string): Effect.Effect<string, LegidError> => {
  if (!prefixRegex.test(prefix)) {
    return fail(prefix, "Prefix must match ^[a-z]+$");
  }

  return Effect.succeed(prefix);
};

const defaultBrandName = (name: string): string =>
  `${name
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")}Id`;

/**
 * Creates a branded legid ID factory for the given name.
 *
 * **Example** (generate and verify a public ID)
 * ```ts
 * import { Effect } from "effect";
 * import { makeLegid } from "@feeblo/id/legid";
 *
 * const PublicId = makeLegid("public", { approximateLength: 12 });
 *
 * // Generate a new ID (Effect)
 * const program = Effect.gen(function* () {
 *   const id = yield* PublicId.generate;
 *   const ok = yield* PublicId.verify(id);
 *   console.log(id, ok); // e.g. "aB3xY9kQ2rMn" true
 * });
 * Effect.runPromise(program);
 *
 * // Or the unsafe Promise API
 * const id = await PublicId.unsafeGenerate();
 * ```
 *
 * **Example** (parse and brand an incoming ID)
 * ```ts
 * import { Effect } from "effect";
 * import { makeLegid } from "@feeblo/id/legid";
 *
 * const PostId = makeLegid("post");
 *
 * const program = Effect.gen(function* () {
 *   const id = yield* PostId.parse(input); // throws LegidError if tampered
 * });
 *
 * // Type guard (format only, not cryptographic)
 * if (PostId.is(input)) {
 *   // input: PostId
 * }
 * ```
 *
 * **Example** (custom salt and brand name)
 * ```ts
 * import { makeLegid } from "@feeblo/id/legid";
 *
 * const CommentId = makeLegid("comment", {
 *   brand: "CommentId",
 *   salt: "feeblo:comment:",
 *   approximateLength: 16,
 * });
 * ```
 */
export const makeLegid = <
  const Name extends string,
  const BrandName extends string = DefaultBrandName<Name>,
>(
  name: Name,
  options?: LegidConfig & { readonly brand?: BrandName }
): LegidFactory<BrandName> => {
  const { salt, approximateLength, step } = options ?? {};

  const legidOptions = {
    ...(salt !== undefined && { salt }),
    ...(approximateLength !== undefined && { approximateLength }),
    ...(step !== undefined && { step }),
  };

  const brand = (options?.brand ?? defaultBrandName(name)) as BrandName;
  const brandLegidId = (id: LegidId): LegidOf<BrandName> =>
    id as LegidOf<BrandName>;

  const generate = Effect.fn(`Legid.${brand}.generate`)(function* () {
    const id = yield* Effect.tryPromise({
      try: () => createId(legidOptions),
      catch: (cause) => new LegidError({ input: "", message: String(cause) }),
    });
    return brandLegidId(LegidId.make(id));
  });

  const verify = Effect.fn(`Legid.${brand}.verify`)(function* (input: string) {
    return yield* Effect.tryPromise(() => verifyId(input, legidOptions)).pipe(
      Effect.catchCause(() => Effect.succeed(false))
    );
  });

  const parse = Effect.fn(`Legid.${brand}.parse`)(function* (input: string) {
    const validId = yield* validateId(input);
    const isValid = yield* verify(input);

    if (!isValid) {
      return yield* fail(
        input,
        "Legid is not valid or was not generated by legid"
      );
    }

    return brandLegidId(validId);
  });

  return {
    brand,
    generate: generate(),
    verify,
    parse,
    is: (input): input is LegidOf<BrandName> => {
      try {
        Effect.runSync(validateId(input));
        return true;
      } catch {
        return false;
      }
    },
    unsafeParse: (input) => Effect.runPromise(parse(input)),
    unsafeGenerate: () => Effect.runPromise(generate()),
  };
};

/**
 * Creates a branded, prefixed legid ID factory.
 *
 * Generated IDs embed a visible `{prefix}_{legid}` separator so the namespace is
 * recognizable in the string itself, while the brand enforces type-level
 * distinction at compile time.
 *
 * **Example** (generate and verify a prefixed ID)
 * ```ts
 * import { Effect } from "effect";
 * import { makePrefixableLegid } from "@feeblo/id/legid";
 *
 * const PostId = makePrefixableLegid("post", "pst", { approximateLength: 12 });
 *
 * const program = Effect.gen(function* () {
 *   const id = yield* PostId.generate; // e.g. "pst_aB3xY9kQ2rMn"
 *   const ok = yield* PostId.verify(id); // true
 * });
 * Effect.runPromise(program);
 * ```
 */
export const makePrefixableLegid = <
  const Name extends string,
  const Prefix extends string,
  const BrandName extends string = DefaultBrandName<Name>,
>(
  name: Name,
  prefix: Prefix,
  options?: LegidConfig & { readonly brand?: BrandName }
): PrefixableLegidFactory<BrandName> => {
  const validPrefix = Effect.runSync(validatePrefix(prefix));
  const { salt, approximateLength, step } = options ?? {};

  const legidOptions = {
    ...(salt !== undefined && { salt }),
    ...(approximateLength !== undefined && { approximateLength }),
    ...(step !== undefined && { step }),
  };

  const brand = (options?.brand ?? defaultBrandName(name)) as BrandName;
  const brandLegidId = (id: LegidId): LegidOf<BrandName> =>
    id as LegidOf<BrandName>;

  const format = (id: string): string =>
    `${validPrefix}_${id}`;

  const splitPrefix = (
    input: string
  ): Effect.Effect<string, LegidError> => {
    const separatorIndex = input.indexOf("_");

    if (separatorIndex === -1) {
      return fail(input, "ID must contain a prefix separator '_'");
    }

    const inputPrefix = input.slice(0, separatorIndex);
    const idPart = input.slice(separatorIndex + 1);

    if (inputPrefix !== validPrefix) {
      return fail(input, `ID prefix must be ${JSON.stringify(validPrefix)}`);
    }

    return Effect.succeed(idPart);
  };

  const generate = Effect.fn(`Legid.${brand}.generate`)(function* () {
    const id = yield* Effect.tryPromise({
      try: () => createId(legidOptions),
      catch: (cause) => new LegidError({ input: "", message: String(cause) }),
    });
    return brandLegidId(LegidId.make(format(id)));
  });

  const verify = Effect.fn(`Legid.${brand}.verify`)(function* (input: string) {
    return yield* Effect.gen(function* () {
      const idPart = yield* splitPrefix(input);
      yield* validateLegidFormat(idPart);
      return yield* Effect.tryPromise(() => verifyId(idPart, legidOptions));
    }).pipe(Effect.catchCause(() => Effect.succeed(false)));
  });

  const parse = Effect.fn(`Legid.${brand}.parse`)(function* (input: string) {
    const idPart = yield* splitPrefix(input);
    yield* validateLegidFormat(idPart);

    const isValid = yield* Effect.tryPromise(() =>
      verifyId(idPart, legidOptions)
    ).pipe(
      Effect.catchCause(() =>
        fail(input, "Legid is not valid or was not generated by legid")
      )
    );

    if (!isValid) {
      return yield* fail(
        input,
        "Legid is not valid or was not generated by legid"
      );
    }

    return brandLegidId(LegidId.make(input));
  });

  return {
    brand,
    prefix: validPrefix,
    generate: generate(),
    verify,
    parse,
    is: (input): input is LegidOf<BrandName> => {
      const separatorIndex = input.indexOf("_");
      if (separatorIndex === -1) return false;

      const inputPrefix = input.slice(0, separatorIndex);
      const idPart = input.slice(separatorIndex + 1);

      if (inputPrefix !== validPrefix) return false;

      try {
        Effect.runSync(validateLegidFormat(idPart));
        return true;
      } catch {
        return false;
      }
    },
    unsafeParse: (input) => Effect.runPromise(parse(input)),
    unsafeGenerate: () => Effect.runPromise(generate()),
  };
};
