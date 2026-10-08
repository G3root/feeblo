import * as Schema from "effect/Schema";

/**
 * The two HTTP projections of an operation input.
 *
 * An endpoint's URL carries some of the operation's fields as path parameters
 * and its body carries the rest. Both are derived from the one input schema
 * the operation declares: `paramsOf` keeps the keys the URL names, and
 * `payloadOf` removes them. Deriving rather than restating means a field added
 * to the operation appears on both projections with the same constraints the
 * MCP tool advertises, a path parameter that names no input field is a compile
 * error at the derivation site, and a handler can pass `{ ...payload, ...
 * params }` as the operation's input by construction.
 */

/**
 * The fields of `fields` whose keys are not in `keys`.
 *
 * The field map's properties are readonly by type, so `Reflect` performs the
 * deletion. The return type is the unmodified map — the key removal is a
 * runtime fact this helper cannot express generically — and each caller
 * restores the exact key set in its own return type with a SAFETY comment.
 */
const fieldsWithout = <Fields extends Schema.Struct.Fields>(
  fields: Fields,
  keys: Iterable<PropertyKey>
): Fields => {
  const remaining = { ...fields };
  for (const key of keys) {
    Reflect.deleteProperty(remaining, key);
  }
  return remaining;
};

/**
 * The HTTP request body of an operation whose URL carries the named path
 * parameters: the input's fields minus the keys the URL names.
 *
 * The operation input is the authority for every field a caller sends, and a
 * resource's HTTP body is a projection of it. A field added to the operation is
 * a field the body accepts, with the same constraints the MCP tool already
 * advertises — a new field cannot be published on one surface and dropped by
 * the other, and a constraint cannot live on only one of the two schemas.
 *
 * The handler then passes the decoded params and payload as
 * `{ ...payload, ...params }`, which covers exactly the operation's input: the
 * payload holds every other field, and the params hold the fields the URL
 * carries.
 */
export const payloadOf = <
  const Fields extends Schema.Struct.Fields,
  const PathKeys extends readonly (keyof Fields)[],
>(
  input: Schema.Struct<Fields>,
  pathKeys: PathKeys
): Schema.Struct<Omit<Fields, PathKeys[number]>> =>
  input.mapFields((fields) => {
    const body = fieldsWithout(fields, pathKeys);
    // SAFETY: `body` starts as the input's complete field map and only the
    // keys in `pathKeys` are deleted, so its remaining fields are exactly the
    // ones `Omit<Fields, PathKeys[number]>` names.
    return body as Omit<Fields, PathKeys[number]>;
  });

/**
 * The path parameters of an operation: the input's fields whose keys the URL
 * names.
 *
 * Taking the parameter schema from the operation input is what makes a path
 * parameter the operation does not declare a compile error: `pathKeys` is
 * constrained to `keyof` the input's fields, so `paramsOf(GetPostInput,
 * ["postId"])` cannot name a field the handler would never receive, and a
 * renamed path segment has to rename the input field with it.
 */
export const paramsOf = <
  const Fields extends Schema.Struct.Fields,
  const PathKeys extends readonly (keyof Fields)[],
>(
  input: Schema.Struct<Fields>,
  pathKeys: PathKeys
): Schema.Struct<Pick<Fields, PathKeys[number]>> => {
  const path = new Set<PropertyKey>(pathKeys);
  const bodyKeys = Object.keys(input.fields).filter((key) => !path.has(key));

  return input.mapFields((fields) => {
    const params = fieldsWithout(fields, bodyKeys);
    // SAFETY: `params` starts as the input's complete field map and only the
    // keys that are not in `pathKeys` are deleted, so the fields that remain
    // are exactly the ones `Pick<Fields, PathKeys[number]>` names.
    return params as Pick<Fields, PathKeys[number]>;
  });
};
