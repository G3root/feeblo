import spriteUrl from "../../../ui/src/icon-picker/generated/tabler-filled-sprite.svg?url";
import { TABLER_FILLED_SYMBOL_PREFIX } from "../../../ui/src/icon-picker/generated/tabler-filled-symbol-prefix";

/**
 * The shared Tabler sprite, fetched as an asset instead of inlined.
 *
 * The widget already inlines its own seven-icon sprite (`?raw`) because that is
 * a few kilobytes. The Tabler sprite is 1,054 symbols (~79 KB gzip), so it is
 * emitted as a content-hashed Vite asset and fetched once, when the first
 * board icon renders. Safari does not support external `<use>` references, so
 * the markup is injected into the iframe document rather than referenced by
 * URL.
 */
const SPRITE_ATTRIBUTE = "data-tabler-filled-sprite";

let loadPromise: Promise<void> | null = null;

export function loadTablerSprite(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }

  if (document.querySelector(`[${SPRITE_ATTRIBUTE}]`)) {
    loadPromise = Promise.resolve();

    return loadPromise;
  }

  loadPromise = fetch(spriteUrl, { credentials: "omit" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Tabler sprite: HTTP ${response.status}`);
      }

      return response.text();
    })
    .then((markup) => {
      mountSprite(markup);
    })
    .catch((error: Error) => {
      // Clear the promise so a later mount can retry a transient failure.
      loadPromise = null;
      throw error;
    });

  return loadPromise;
}

export function tablerIconHref(name: string): string {
  return `#${TABLER_FILLED_SYMBOL_PREFIX}${name}`;
}

function mountSprite(markup: string): void {
  const start = markup.indexOf("<svg");

  if (start === -1) {
    throw new Error("Tabler sprite has no <svg> root");
  }

  const holder = document.createElement("div");

  holder.setAttribute(SPRITE_ATTRIBUTE, "");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  holder.innerHTML = markup.slice(start);
  document.body.appendChild(holder);
}
