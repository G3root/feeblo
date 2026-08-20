import * as React from "react";

import type { WidgetModule } from "../types";
import { useFeebloContext } from "./context";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FeebloTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional board to scope the feedback to when opening. */
  readonly board?: string | undefined;
  /**
   * Metadata forwarded as `open(trigger, metadata)`. Useful for attaching
   * page context without a separate `metadata()` call.
   */
  readonly metadata?: Record<string, string> | undefined;
  /** Which module to open (defaults to the provider's landing module). */
  readonly module?: WidgetModule | undefined;
  /**
   * When true the trigger renders its child as the clickable element (like
   * Radix `asChild`). Requires exactly one React element child.
   */
  readonly asChild?: boolean | undefined;
}

type TriggerChildProps = {
  readonly onClick?: React.MouseEventHandler<HTMLElement> | undefined;
  readonly ref?: React.Ref<HTMLElement> | undefined;
};

export interface UseFeebloTriggerResult {
  readonly onClick: React.MouseEventHandler<HTMLElement>;
  readonly ref: React.RefCallback<HTMLElement>;
}

function mergeTriggerMetadata(
  board: string | undefined,
  metadata: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!board && !metadata) return undefined;

  const mergedMetadata = { ...metadata };
  if (board) {
    mergedMetadata.board = board;
  }
  return mergedMetadata;
}

// ---------------------------------------------------------------------------
// Component — no inline component definitions (rerender-no-inline-components)
// ---------------------------------------------------------------------------

/**
 * Clickable trigger that opens the Feeblo widget anchored to itself.
 *
 * Anchoring uses Floating UI inside the SDK — the widget will be positioned
 * next to the trigger element.
 *
 * @example
 * <FeebloTrigger>Give feedback</FeebloTrigger>
 * @example
 * <FeebloTrigger asChild><a href="#">Feedback</a></FeebloTrigger>
 */
export const FeebloTrigger = React.forwardRef<HTMLElement, FeebloTriggerProps>(
  function FeebloTrigger(props, forwardedRef) {
    const {
      board,
      metadata,
      module,
      asChild = false,
      children,
      onClick,
      ...buttonProps
    } = props;

    const { open, openModule } = useFeebloContext();
    const innerRef = React.useRef<HTMLElement | null>(null);

    // Merge forwarded + inner ref (js-cache-property-access / rerender-lazy-state-init not needed)
    const setRef = React.useCallback(
      (node: HTMLElement | null) => {
        innerRef.current = node;
        if (forwardedRef && "current" in forwardedRef) {
          forwardedRef.current = node;
        } else if (forwardedRef) {
          forwardedRef(node);
        }
      },
      [forwardedRef]
    );

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLElement>) => {
        // SAFETY: the public onClick prop is only invoked by the button variant.
        onClick?.(e as React.MouseEvent<HTMLButtonElement>);
        if (e.defaultPrevented) return;

        const triggerEl = innerRef.current;
        if (!triggerEl) return;

        // Merge board into metadata so both reach the SDK's open() path
        const mergedMeta = mergeTriggerMetadata(board, metadata);

        if (module) {
          openModule(module);
          // openModule already calls open() internally when needed, but when we
          // have an anchor we want the anchored variant. Re-open with anchor.
          open(triggerEl, mergedMeta);
        } else {
          open(triggerEl, mergedMeta);
        }
      },
      [onClick, board, metadata, module, open, openModule]
    );

    if (asChild) {
      // Clone the single child and attach trigger behaviour.
      // This matches the `asChild` pattern familiar from shadcn / Radix without
      // pulling in @radix-ui/react-slot — keeps bundle lean (bundle-barrel-imports).
      const child = React.Children.only(children);
      if (!React.isValidElement<TriggerChildProps>(child)) {
        throw new Error("FeebloTrigger asChild requires a React element");
      }

      // Preserve child's onClick via composition
      const childOnClick = child.props.onClick;

      return React.cloneElement(child, {
        ref: setRef,
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          childOnClick?.(e);
          handleClick(e);
        },
      });
    }

    return (
      <button
        ref={setRef}
        type="button"
        data-feeblo-trigger="react"
        onClick={handleClick}
        {...buttonProps}
      >
        {children ?? "Give feedback"}
      </button>
    );
  }
);

FeebloTrigger.displayName = "FeebloTrigger";

// ---------------------------------------------------------------------------
// Hook alternative — useFeebloTrigger (for custom elements)
// ---------------------------------------------------------------------------

export interface UseFeebloTriggerOptions {
  readonly board?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly module?: WidgetModule | undefined;
}

export function useFeebloTrigger(
  options: UseFeebloTriggerOptions = {}
): UseFeebloTriggerResult {
  const { board, metadata, module } = options;
  const { open, openModule } = useFeebloContext();
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const ref = React.useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  const onClick = React.useCallback<React.MouseEventHandler<HTMLElement>>(
    (e) => {
      if (e.defaultPrevented) return;
      const el = triggerRef.current;
      if (!el) return;
      const mergedMeta = mergeTriggerMetadata(board, metadata);
      if (module) {
        openModule(module);
        open(el, mergedMeta);
      } else {
        open(el, mergedMeta);
      }
    },
    [board, metadata, module, open, openModule]
  );

  return { ref, onClick };
}
