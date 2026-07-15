import * as Schema from "effect/Schema";

export class UserPersistenceError extends Schema.TaggedErrorClass<UserPersistenceError>()(
  "UserPersistenceError",
  { message: Schema.String },
  { httpApiStatus: 500, identifier: "UserPersistenceError" }
) {}
