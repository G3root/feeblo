import * as Schema from "effect/Schema";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from "../rpc-errors";
import { ProviderLifecycleEvent } from "./schema";

export const EmailProviderFeedbackAccepted = Schema.Union([
  Schema.Struct({ result: Schema.tag("duplicate") }),
  Schema.Struct({ result: Schema.tag("processed") }),
  Schema.Struct({ result: Schema.tag("unknown_delivery") }),
]).pipe(Schema.toTaggedUnion("result"));

/** Authenticated ingestion endpoint for provider delivery lifecycle events. */
export class EmailProviderFeedbackApiGroup extends HttpApiGroup.make(
  "EmailProviderFeedbackApiGroup"
).add(
  HttpApiEndpoint.post(
    "ingestEmailProviderFeedback",
    "/email-provider/events",
    {
      error: Schema.Union([
        BadRequestError,
        InternalServerError,
        UnauthorizedError,
      ]),
      headers: {
        "x-email-provider-token": Schema.String,
      },
      payload: ProviderLifecycleEvent,
      success: EmailProviderFeedbackAccepted,
    }
  )
) {}
