/** External custom-webhook payload schema. It deliberately excludes emails, credentials, and account identifiers. */
import {
  IntegrationEventIdentity,
  IntegrationEventType,
  IntegrationPostStatus,
} from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** The post an event is about, projected for a receiver. */
export const WebhookPostObject = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** Sanitized markdown, carried on every event so a receiver never has to fetch it. */
  content: Schema.String,
  url: Schema.String,
  status: IntegrationPostStatus,
  author: IntegrationEventIdentity,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** V1 post webhook payload, serialized once and signed exactly as sent. */
export const WebhookExternalPayload = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  type: IntegrationEventType,
  version: Schema.Literal(1),
  occurredAt: Schema.String,
  objectType: Schema.Literal("post"),
  object: WebhookPostObject,
  board: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    url: Schema.String,
  }),
  actor: IntegrationEventIdentity,
  /** What moved, named per field; `object` carries the next state. */
  changes: Schema.optionalKey(
    Schema.Struct({
      status: Schema.optionalKey(
        Schema.Struct({
          from: IntegrationPostStatus,
          to: IntegrationPostStatus,
        })
      ),
    })
  ),
});

export type WebhookExternalPayload = Schema.Schema.Type<
  typeof WebhookExternalPayload
>;
