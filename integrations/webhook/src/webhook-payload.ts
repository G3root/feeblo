/** External custom-webhook payload schema. It deliberately excludes emails, post content, and credentials. */
import {
  IntegrationEventType,
  IntegrationPostStatusType,
} from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** Safe actor classification that never sends external users' personal details. */
export const WebhookActor = Schema.Literals(["member", "end_user"]);

/** V1 post webhook payload, serialized once and signed exactly as sent. */
export const WebhookExternalPayload = Schema.Struct({
  id: Schema.String,
  type: IntegrationEventType,
  version: Schema.Literal(1),
  occurredAt: Schema.String,
  organizationId: Schema.String,
  post: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    url: Schema.String,
  }),
  board: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
  }),
  status: Schema.Struct({ id: Schema.String, type: IntegrationPostStatusType }),
  previousStatus: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, type: IntegrationPostStatusType })
  ),
  actor: Schema.Struct({
    type: WebhookActor,
    memberId: Schema.optionalKey(Schema.String),
    displayName: Schema.optionalKey(Schema.String),
  }),
});

export type WebhookExternalPayload = Schema.Schema.Type<
  typeof WebhookExternalPayload
>;
