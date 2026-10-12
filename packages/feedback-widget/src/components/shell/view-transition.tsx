import { type JSX, onMount } from "solid-js";

/**
 * The entry animation for one surface view.
 *
 * A root view rises in place; a pushed view slides in from the side, which is
 * what makes back navigation read as a pop. The animation is CSS-only and
 * entry-only (see `widget.css`): the outgoing view is replaced in the same
 * frame, so there is no exit to sequence and nothing a rapid tab switch can
 * queue behind.
 *
 * Every view takes focus when it mounts. Navigating between views unmounts
 * the control the visitor activated (a board card, the back arrow), and
 * without this focus would fall to the document body — the keyboard and
 * screen-reader position would be silently lost. A root view needs it for the
 * same reason: the shell's back control belongs to the pushed view, so its
 * list would otherwise be left with focus nowhere.
 */
export function ViewTransition(props: {
  children: JSX.Element;
  kind: "root" | "push";
}) {
  let element: HTMLDivElement | undefined;

  onMount(() => {
    // A field inside the view may claim focus while mounting (the composer
    // focuses its title). Only take the focus the element would otherwise
    // drop on <body>.
    queueMicrotask(() => {
      if (document.activeElement === document.body) {
        element?.focus({ preventScroll: true });
      }
    });
  });

  return (
    <div
      class="widget-enter flex min-h-full flex-col outline-none"
      data-enter={props.kind === "push" ? "push" : "rise"}
      data-slot="widget-view"
      ref={element}
      tabIndex={-1}
    >
      {props.children}
    </div>
  );
}
