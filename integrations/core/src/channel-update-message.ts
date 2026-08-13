/**
 * Channel-update message model shared by channel-notification providers
 * (Slack, Discord). Providers render this pure model into their own wire
 * format (Block Kit blocks, embeds); no provider-specific types leak into
 * the model.
 */
export interface ChannelUpdateMessage {
  /** Absolute URL to open the post. */
  readonly actionUrl: string;
  /** Display name of the actor, when known. */
  readonly actorName?: string;
  /** Event type that produced the update. */
  readonly eventType: string;
  /** Facts rendered as key/value rows, e.g. board and status. */
  readonly facts: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  /** Post title, truncated for channel display by the renderer. */
  readonly title: string;
}
