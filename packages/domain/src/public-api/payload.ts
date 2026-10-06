import * as Schema from "effect/Schema";

/**
 * The HTTP request body of an operation whose URL carries the named path
 * parameters.
 *
 * The operation input is the authority for every field a caller sends, and a
 * resource's HTTP body is a projection of it: the same field schemas, without
 * the keys the URL carries. Deriving the body rather than restating it means
 * a field added to the operation is a field the HTTP payload accepts, with the
 * same constraints the MCP tool already advertises — a new field cannot be
 * published on one surface and dropped by the other, and a constraint cannot
 * live on only one of the two schemas.
 *
 * The handler then passes the decoded params and payload as
 * `{ ...payload, ...path }`, which covers exactly the operation's input: the
 * payload holds every body field, and the params hold every field the URL
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
    // Spreading first keeps the function from mutating the input struct's own
    // field map; the deletes then remove the keys the URL carries, which is
    // what makes the body total over the remaining fields. `Reflect` is used
    // because the field map's properties are readonly by type, and the keys
    // are exactly the ones the type parameter names.
    const body = { ...fields };
    for (const key of pathKeys) {
      Reflect.deleteProperty(body, key);
    }
    // SAFETY: `body` starts as the input's complete field map and only the
    // keys in `pathKeys` are deleted, so its remaining fields are exactly the
    // ones `Omit<Fields, PathKeys[number]>` names.
    return body as Omit<Fields, PathKeys[number]>;
  });
