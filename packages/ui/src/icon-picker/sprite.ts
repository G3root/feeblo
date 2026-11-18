import { useEffect, useSyncExternalStore } from "react";

import spriteUrl from "./generated/tabler-filled-sprite.svg?url";
import type { IconPickerSpriteStatus } from "./types";

const SPRITE_ATTRIBUTE = "data-icon-picker-sprite";

type Listener = () => void;

type SpriteState = {
  listeners: Set<Listener>;
  loadPromise: Promise<void> | null;
  status: IconPickerSpriteStatus;
};

/**
 * A module-level store rather than React state: the sprite is one document-wide
 * asset, so two pickers on the same page must share one fetch and one set of
 * `<symbol>` ids. The three fields live on one object so the lifecycle has one
 * owner rather than three module-level bindings reassigned from different
 * functions.
 */
const spriteState: SpriteState = {
  listeners: new Set<Listener>(),
  loadPromise: null,
  status: "idle",
};

function setStatus(next: IconPickerSpriteStatus): void {
  if (spriteState.status === next) {
    return;
  }

  spriteState.status = next;

  for (const listener of spriteState.listeners) {
    listener();
  }
}

function subscribe(listener: Listener): () => void {
  spriteState.listeners.add(listener);

  return () => {
    spriteState.listeners.delete(listener);
  };
}

function getStatus(): IconPickerSpriteStatus {
  return spriteState.status;
}

function getServerStatus(): IconPickerSpriteStatus {
  // Nothing is fetched during SSR, and the server snapshot must not disagree
  // with the first client render or React discards hydration.
  return "idle";
}

export function useIconPickerSpriteStatus(): IconPickerSpriteStatus {
  return useSyncExternalStore(subscribe, getStatus, getServerStatus);
}

/**
 * Fetches the sprite once and mounts its symbols in the document.
 *
 * The icons are referenced with `<use href="#…">`, which resolves against the
 * current document — an external `href="sprite.svg#id"` is not supported by
 * Safari, so the markup is fetched as text and inserted here. The container is
 * zero-sized and absolutely positioned rather than `display: none`: a symbol
 * inside a hidden subtree is not reliably rendered as a shadow tree by every
 * browser.
 */
export function loadIconPickerSprite(): Promise<void> {
  if (spriteState.loadPromise) {
    return spriteState.loadPromise;
  }

  if (
    !("document" in globalThis) ||
    document.querySelector(`[${SPRITE_ATTRIBUTE}]`)
  ) {
    setStatus("ready");

    return Promise.resolve();
  }

  setStatus("loading");

  spriteState.loadPromise = fetch(spriteUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `The icon sprite request failed with HTTP ${response.status}.`
        );
      }

      return response.text();
    })
    .then((markup) => {
      mountSprite(markup);
      setStatus("ready");
    })
    // The only rejection in this chain is the Error thrown above; `fetch`
    // rejects with a TypeError, which is also an Error.
    .catch((error: Error) => {
      // Clear the promise so the next picker that mounts retries, rather than
      // sharing a failure that may have been a transient network error.
      spriteState.loadPromise = null;
      setStatus("error");
      console.error("Failed to load the icon picker sprite.", error);
    });

  return spriteState.loadPromise;
}

/**
 * Starts the fetch on mount. Any icon renders before the request finishes as
 * an empty `<svg>`; the picker's `Loading` part reads the same status.
 */
export function useIconPickerSprite(): void {
  useEffect(() => {
    void loadIconPickerSprite();
  }, []);
}

function mountSprite(markup: string): void {
  const holder = document.createElement("div");

  holder.setAttribute(SPRITE_ATTRIBUTE, "");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  holder.innerHTML = markup;
  document.body.appendChild(holder);
}
