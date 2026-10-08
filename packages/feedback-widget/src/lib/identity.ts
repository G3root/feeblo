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
export type WidgetUserIdentity = TWidgetIdentity;

export type WidgetIdentity = TWidgetIdentity;

const [identity, setIdentity] = createSignal<WidgetIdentity | null>(null);

export function getWidgetIdentity(): WidgetIdentity | null {
  return identity();
}

export function getWidgetToken(): string | null {
  const current = identity();
  return current?.token ?? null;
}

export function setWidgetIdentity(data: WidgetIdentity): void {
  setIdentity(data);
}

export function clearWidgetIdentity(): void {
  setIdentity(null);
}
