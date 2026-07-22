import type * as Brand from "effect/Brand";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

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
  readonly is: (input: string) => input is LegidOf<Name>;
  readonly parse: (input: string) => Effect.Effect<LegidOf<Name>, LegidError>;
  readonly schema: Schema.Codec<LegidOf<Name>, string>;
  readonly unsafeGenerate: () => Promise<LegidOf<Name>>;
  readonly unsafeParse: (input: string) => Promise<LegidOf<Name>>;
  readonly verify: (input: string) => Effect.Effect<boolean>;
}

export interface PrefixableLegidFactory<Name extends string>
  extends LegidFactory<Name> {
  readonly prefix: string;
}

/**
 * Type-only helper that casts a single raw legid string into a branded legid
 * for the supplied factory. Use this when loading a single ID from a trusted
 * source (such as a database row) and you only need compile-time safety.
 */
export const asLegid =
  <Name extends string>(
    _factory: LegidFactory<Name>
  ): ((input: string) => LegidOf<Name>) =>
  (input) =>
    input as unknown as LegidOf<Name>;

/**
 * Type-only helper that brands the `id` field of a single object using the
 * supplied legid factory. Use this when loading a single row from a trusted
 * source such as the database.
 */
export const asLegidById =
  <Name extends string>(_factory: LegidFactory<Name>) =>
  <T extends { id: string }>(input: T): WithLegidId<Name, T> =>
    input as unknown as WithLegidId<Name, T>;

export type LegidFrom<Factory> =
  Factory extends LegidFactory<infer Name> ? LegidOf<Name> : never;

/**
 * A type-only array of branded IDs for a given legid brand.
 *
 * Use this when data coming from a trusted source (for example, the database)
 * is already known to be valid and you only need compile-time branding on an
 * array of IDs.
 */
export type LegidArray<Name extends string> = readonly LegidOf<Name>[];

/**
 * Type-only helper that casts an array of raw legid strings into an array of
 * branded IDs for the supplied factory.
 *
 * Use this when loading IDs from a trusted source such as the database and you
 * only need compile-time safety.
 */
export const asLegidArray = <Name extends string>(
  _factory: LegidFactory<Name>
): ((input: readonly string[]) => LegidArray<Name>) => {
  return (input) => input as unknown as LegidArray<Name>;
};

/**
 * A type-only object whose `id` field has been branded with a legid brand.
 */
export type WithLegidId<Name extends string, T extends { id: string }> = Omit<
  T,
  "id"
> & {
  readonly id: LegidOf<Name>;
};

/**
 * Type-only helper that casts an array of objects with an `id` string into an
 * array of objects whose `id` is branded for the supplied factory.
 *
 * Use this when loading rows from a trusted source such as the database and you
 * only need compile-time safety on the `id` field.
 */
export const asLegidArrayById =
  <Name extends string>(_factory: LegidFactory<Name>) =>
  <T extends { id: string }>(
    input: readonly T[]
  ): readonly WithLegidId<Name, T>[] =>
    input as unknown as readonly WithLegidId<Name, T>[];

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
 * Creates a branded, prefixed legid ID factory.
 *
 * Generated IDs embed a visible `{prefix}_{legid}` separator so the namespace is
 * recognizable in the string itself, while the brand enforces type-level
 * distinction at compile time.
 *
 * **Example** (generate and verify a prefixed ID)
 * ```ts
 * import { Effect } from "effect";
 * import { makeId } from "@feeblo/id/legid";
 *
 * const PostId = makeId("post", "pst", { approximateLength: 12 });
 *
 * const program = Effect.gen(function* () {
 *   const id = yield* PostId.generate; // e.g. "pst_aB3xY9kQ2rMn"
 *   const ok = yield* PostId.verify(id); // true
 * });
 * Effect.runPromise(program);
 * ```
 */
export const makeId = <
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

  const format = (id: string): string => `${validPrefix}_${id}`;

  const splitPrefix = (input: string): Effect.Effect<string, LegidError> => {
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

  const idSchema = Schema.String.pipe(
    Schema.brand("LegidId"),
    Schema.brand(brand)
  ) as Schema.Codec<LegidOf<BrandName>, string>;

  return {
    brand,
    prefix: validPrefix,
    schema: idSchema,
    generate: generate(),
    verify,
    parse,
    is: (input): input is LegidOf<BrandName> => {
      const separatorIndex = input.indexOf("_");
      if (separatorIndex === -1) {
        return false;
      }

      const inputPrefix = input.slice(0, separatorIndex);
      const idPart = input.slice(separatorIndex + 1);

      if (inputPrefix !== validPrefix) {
        return false;
      }

      return Exit.isSuccess(Effect.runSyncExit(validateLegidFormat(idPart)));
    },
    unsafeParse: (input) => Effect.runPromise(parse(input)),
    unsafeGenerate: () => Effect.runPromise(generate()),
  };
};
