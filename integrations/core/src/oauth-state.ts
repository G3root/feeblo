import { IntegrationConnectionId, WorkspaceId } from "@feeblo/id";
import * as Schema from "effect/Schema";

/**
 * OAuth state token passed through every provider install flow (Slack,
 * Discord). It is not a secret; the connection lookup is additionally guarded
 * by the encrypted nonce stored on the pending connection row.
 */
export const IntegrationOAuthState = Schema.Struct({
  connectionId: IntegrationConnectionId.schema,
  organizationId: WorkspaceId.schema,
  nonce: Schema.String,
});
export type IntegrationOAuthState = Schema.Schema.Type<
  typeof IntegrationOAuthState
>;
