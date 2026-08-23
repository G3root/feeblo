import type {
  DiscordInteraction,
  DiscordInteractionCallback,
} from "@feeblo/domain-contracts/discord-inbound";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** HTTP response the server route returns to Discord. */
export interface DiscordInboundHttpResponse {
  /** Absent means an empty 200 body. */
  readonly body?: DiscordInteractionCallback;
  readonly status: number;
}

/** Inbound Discord surface: every interaction type arriving at `/discord/interactions`. */
export interface DiscordInboundServiceContract {
  readonly handleInteraction: (
    payload: DiscordInteraction
  ) => Effect.Effect<DiscordInboundHttpResponse, never>;
}

/** Service key implemented by the server composition root. */
export class DiscordInboundService extends Context.Service<
  DiscordInboundService,
  DiscordInboundServiceContract
>()("@feeblo/DiscordInboundService") {}
