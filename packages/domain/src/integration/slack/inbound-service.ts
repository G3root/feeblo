import type {
  SlackInteractivePayload,
  SlackSlashCommandPayload,
} from "@feeblo/integration-slack/inbound-schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** HTTP response the server route returns to Slack. */
export interface SlackInboundHttpResponse {
  /** Absent means an empty 200 body; Slack displays nothing. */
  readonly body?: unknown;
  readonly status: number;
}

/** Inbound Slack surface: slash command, message action, and modal submission. */
export interface SlackInboundServiceShape {
  readonly handleInteractive: (
    payload: SlackInteractivePayload
  ) => Effect.Effect<SlackInboundHttpResponse, never>;
  readonly handleSlashCommand: (
    payload: SlackSlashCommandPayload
  ) => Effect.Effect<SlackInboundHttpResponse, never>;
}

/** Service key implemented by the server composition root. */
export class SlackInboundService extends Context.Service<
  SlackInboundService,
  SlackInboundServiceShape
>()("@feeblo/SlackInboundService") {}
