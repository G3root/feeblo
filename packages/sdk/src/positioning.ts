import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import type { Logger } from "./debug";

export function createFloatingInstance(
  reference: HTMLElement,
  floating: HTMLElement,
  logger?: Logger
): () => void {
  return autoUpdate(reference, floating, () => {
    computePosition(reference, floating, {
      placement: "bottom",
      middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (logger?.enabled) {
        logger("positioning", { x, y });
      }
      Object.assign(floating.style, {
        left: `${x}px`,
        top: `${y}px`,
      });
    });
  });
}
