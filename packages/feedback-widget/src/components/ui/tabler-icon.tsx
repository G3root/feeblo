import {
  createSignal,
  onMount,
  splitProps,
  type ComponentProps,
} from "solid-js";

import { loadTablerSprite, tablerIconHref } from "../../lib/tabler-sprite";
import { cn } from "../../lib/utils";

/**
 * One Tabler icon from the shared sprite.
 *
 * The sprite is fetched on the first icon mount and injected into the iframe
 * document; the `<use>` is rendered only after the symbols exist. The module
 * loader dedupes the request, so a board list with several icons downloads the
 * sprite once and every later iframe navigation reuses the HTTP cache.
 */
export function TablerIcon(props: ComponentProps<"svg"> & { name: string }) {
  const [local, others] = splitProps(props, ["name", "class"]);
  const [ready, setReady] = createSignal(false);

  onMount(() => {
    void loadTablerSprite()
      .then(() => setReady(true))
      .catch(() => {
        // The icon is decorative: a blocked sprite must not replace the board
        // list or the feedback form with an error.
      });
  });

  return (
    <svg
      aria-hidden="true"
      class={cn("size-4 shrink-0 fill-current", local.class)}
      {...others}
    >
      {ready() ? <use href={tablerIconHref(local.name)} /> : null}
    </svg>
  );
}
