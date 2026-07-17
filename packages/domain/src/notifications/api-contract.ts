import * as Schema from "effect/Schema";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import { InvalidUnsubscribeTokenError } from "./tokens";

const TokenParams = { token: Schema.String };
const Confirmation = Schema.Struct({
  kind: Schema.Literals(["post", "digest"]),
  active: Schema.Boolean,
  label: Schema.String,
  organizationName: Schema.String,
});

export class NotificationApiGroup extends HttpApiGroup.make(
  "NotificationApiGroup"
)
  .add(
    HttpApiEndpoint.get(
      "inspectUnsubscribe",
      "/notifications/unsubscribe/:token",
      {
        params: TokenParams,
        success: Confirmation,
        error: Schema.Union([
          BadRequestError,
          InternalServerError,
          InvalidUnsubscribeTokenError,
        ]),
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "applyUnsubscribe",
      "/notifications/unsubscribe/:token",
      {
        params: TokenParams,
        success: Schema.Void,
        error: Schema.Union([
          BadRequestError,
          InternalServerError,
          InvalidUnsubscribeTokenError,
        ]),
      }
    )
  ) {}
