import { createHmac, timingSafeEqual } from "node:crypto";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export const UnsubscribeKind = Schema.Literals(["post", "digest"]);
export type UnsubscribeKind = typeof UnsubscribeKind.Type;

const TokenPayload = Schema.Struct({
  version: Schema.Literal(1),
  kind: UnsubscribeKind,
  resourceId: Schema.String,
});

export type UnsubscribeTokenPayload = typeof TokenPayload.Type;

const secret = Config.redacted("UNSUBSCRIBE_SECRET").pipe(
  Config.orElse(() => Config.redacted("AUTH_SECRET")),
  Effect.map(Redacted.value)
);

const signature = (encodedPayload: string, key: string) =>
  createHmac("sha256", key).update(encodedPayload).digest("base64url");

export const signUnsubscribeToken = Effect.fn(
  "Notifications.signUnsubscribeToken"
)(function* (payload: UnsubscribeTokenPayload) {
  const key = yield* secret;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  return `${encodedPayload}.${signature(encodedPayload, key)}`;
});

export class InvalidUnsubscribeTokenError extends Schema.TaggedErrorClass<InvalidUnsubscribeTokenError>()(
  "InvalidUnsubscribeTokenError",
  { message: Schema.String },
  //TODO check correct
  { httpApiStatus: 400, identifier: "BadRequestError" }
) {}

export const verifyUnsubscribeToken = Effect.fn(
  "Notifications.verifyUnsubscribeToken"
)(function* (token: string) {
  const key = yield* secret;
  const [encodedPayload, suppliedSignature, ...rest] = token.split(".");
  if (!(encodedPayload && suppliedSignature) || rest.length > 0) {
    return yield* new InvalidUnsubscribeTokenError({
      message: "Invalid unsubscribe token",
    });
  }

  const expected = Buffer.from(signature(encodedPayload, key));
  const supplied = Buffer.from(suppliedSignature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return yield* new InvalidUnsubscribeTokenError({
      message: "Invalid unsubscribe token",
    });
  }

  const decoded = yield* Effect.try({
    try: () => JSON.parse(Buffer.from(encodedPayload, "base64url").toString()),
    catch: () =>
      new InvalidUnsubscribeTokenError({
        message: "Invalid unsubscribe token",
      }),
  });
  return yield* Schema.decodeUnknownEffect(TokenPayload)(decoded).pipe(
    Effect.mapError(
      () =>
        new InvalidUnsubscribeTokenError({
          message: "Invalid unsubscribe token",
        })
    )
  );
});
