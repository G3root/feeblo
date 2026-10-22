import type { TWidgetIdentity } from "@feeblo/domain/widget/schema";
import { createSignal } from "solid-js";

/**
 * The identity the embedding page posts to the iframe.
 *
 * The shape is the widget contract's `WidgetIdentity`, not a hand-written copy:
 * the SDK normalizes the embedder's `UserIdentity` into it and posts it as the
 * `IDENTIFY` message, so the iframe's receiver and the sender cannot disagree
 * about the fields. The iframe's previous copy narrowed `customFields` to
 * scalars, which silently dropped the nested values the SDK permits.
 */
export type WidgetIdentity = TWidgetIdentity;

const [identity, setIdentity] = createSignal<WidgetIdentity | null>(null);

/**
 * The identity is written by the embedder and read only for its token; the
 * token is what the widget's API calls authenticate with.
 */
export function getWidgetToken(): string | null {
  const current = identity();
  return current?.token ?? null;
}

export function setWidgetIdentity(data: WidgetIdentity): void {
  setIdentity(data);
}
