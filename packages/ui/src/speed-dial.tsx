import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { hasWindow, isFunction } from "@feeblo/utils/runtime-kind";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { Button } from "./button";
import { cn } from "./utils";

const ROOT_NAME = "SpeedDial";
const TRIGGER_NAME = "SpeedDialTrigger";
const CONTENT_NAME = "SpeedDialContent";
const ITEM_NAME = "SpeedDialItem";
const ACTION_NAME = "SpeedDialAction";
const LABEL_NAME = "SpeedDialLabel";

const ACTION_SELECT = "speedDial.actionSelect";
const INTERACT_OUTSIDE = "speedDial.interactOutside";
const EVENT_OPTIONS = { bubbles: true, cancelable: true };

const DEFAULT_GAP = 8;
const DEFAULT_OFFSET = 8;
const DEFAULT_ITEM_DELAY = 50;
const DEFAULT_HOVER_CLOSE_DELAY = 100;
const DEFAULT_ANIMATION_DURATION = 200;

const noop = (): void => undefined;

type Side = "top" | "right" | "bottom" | "left";
type ActivationMode = "click" | "hover";

type DivProps = useRender.ComponentProps<"div">;

type RootElement = HTMLDivElement;
type ContentElement = HTMLDivElement;
type TriggerElement = HTMLButtonElement;
type ActionElement = HTMLButtonElement;

interface InteractOutsideDetail {
  originalEvent: PointerEvent;
}

type InteractOutsideEvent = CustomEvent<InteractOutsideDetail>;

const useIsoLayoutEffect: typeof React.useLayoutEffect = hasWindow()
  ? React.useLayoutEffect
  : React.useEffect;

function getDataState(open: boolean): string {
  return open ? "open" : "closed";
}

function isRefCallback<T>(
  ref: React.Ref<T> | undefined
): ref is React.RefCallback<T> {
  return isFunction(ref);
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (ref === null || ref === undefined) {
    return;
  }
  if (isRefCallback(ref)) {
    ref(value);
    return;
  }
  ref.current = value;
}

function useMergedRefs<T>(
  external: React.Ref<T> | undefined,
  internal: React.RefObject<T | null>
): React.RefCallback<T> {
  return React.useCallback(
    (node: T | null) => {
      setRef(external, node);
      setRef(internal, node);
    },
    [external, internal]
  );
}

function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

interface StoreState {
  open: boolean;
}

interface Store {
  subscribe: (callback: () => void) => () => void;
  getState: () => StoreState;
  setOpen: (open: boolean) => void;
  notify: () => void;
}

const StoreContext = React.createContext<Store | null>(null);

function useStoreContext(consumerName: string): Store {
  const context = React.useContext(StoreContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

function useStore<T>(
  selector: (state: StoreState) => T,
  ogStore?: Store | null
): T {
  const contextStore = React.useContext(StoreContext);
  const store = ogStore ?? contextStore;

  if (!store) {
    throw new Error(`\`useStore\` must be used within \`${ROOT_NAME}\``);
  }

  const getSnapshot = React.useCallback(
    () => selector(store.getState()),
    [store, selector]
  );

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

interface NodeData {
  id: string;
  ref: React.RefObject<HTMLElement | null>;
  disabled: boolean;
}

interface SpeedDialContextValue {
  onNodeRegister: (node: NodeData) => void;
  onNodeUnregister: (id: string) => void;
  getNodes: () => NodeData[];
  contentId: string;
  rootRef: React.RefObject<RootElement | null>;
  triggerRef: React.RefObject<TriggerElement | null>;
  isPointerInsideReactTreeRef: React.RefObject<boolean>;
  hoverCloseTimerRef: React.RefObject<number | null>;
  side: Side;
  activationMode: ActivationMode;
  delay: number;
  disabled: boolean;
}

const SpeedDialContext = React.createContext<SpeedDialContextValue | null>(
  null
);

function useSpeedDialContext(consumerName: string): SpeedDialContextValue {
  const context = React.useContext(SpeedDialContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

interface SpeedDialProps extends DivProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  activationMode?: ActivationMode;
  delay?: number;
  disabled?: boolean;
}

function SpeedDial(props: SpeedDialProps): React.ReactElement {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    onPointerDownCapture: onPointerDownCaptureProp,
    side = "top",
    activationMode = "click",
    delay = 250,
    render,
    disabled = false,
    className,
    ref,
    ...rootProps
  } = props;

  const contentId = React.useId();

  const rootRef = React.useRef<RootElement | null>(null);
  const composedRefs = useMergedRefs(ref, rootRef);

  const triggerRef = React.useRef<TriggerElement | null>(null);

  const nodesRef = React.useRef<Map<string, NodeData>>(new Map());
  const isPointerInsideReactTreeRef = React.useRef(false);
  const hoverCloseTimerRef = React.useRef<number | null>(null);

  const listenersRef = React.useRef(new Set<() => void>());
  const stateRef = React.useRef<StoreState>({
    open: openProp ?? defaultOpen ?? false,
  });

  const propsRef = useLatestRef({
    onOpenChange,
    onPointerDownCapture: onPointerDownCaptureProp,
  });

  const store = React.useMemo<Store>(() => {
    return {
      subscribe: (cb) => {
        listenersRef.current.add(cb);
        return () => {
          listenersRef.current.delete(cb);
        };
      },
      getState: () => stateRef.current,
      setOpen: (open) => {
        if (Object.is(stateRef.current.open, open)) {
          return;
        }
        stateRef.current.open = open;
        propsRef.current.onOpenChange?.(open);
        store.notify();
      },
      notify: () => {
        for (const cb of listenersRef.current) {
          cb();
        }
      },
    };
  }, [listenersRef, stateRef, propsRef]);

  const getNodes = React.useCallback(() => {
    return Array.from(nodesRef.current.values())
      .filter((node) => node.ref.current)
      .sort((a, b) => {
        const elementA = a.ref.current;
        const elementB = b.ref.current;
        if (!(elementA && elementB)) {
          return 0;
        }
        const position = elementA.compareDocumentPosition(elementB);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          return -1;
        }
        if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          return 1;
        }
        return 0;
      });
  }, []);

  const onNodeRegister = React.useCallback((node: NodeData) => {
    nodesRef.current.set(node.id, node);
  }, []);

  const onNodeUnregister = React.useCallback((id: string) => {
    nodesRef.current.delete(id);
  }, []);

  useIsoLayoutEffect(() => {
    if (openProp === undefined) {
      return;
    }
    store.setOpen(openProp);
  }, [openProp, store]);

  const open = useStore((state) => state.open, store);

  const onPointerDownCapture = React.useCallback(
    (event: React.PointerEvent<RootElement>) => {
      propsRef.current.onPointerDownCapture?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target;
      const isInteractiveElement =
        target instanceof Node &&
        getNodes().some((node) => node.ref.current?.contains(target) === true);

      isPointerInsideReactTreeRef.current = isInteractiveElement;
    },
    [propsRef, getNodes]
  );

  const contextValue = React.useMemo<SpeedDialContextValue>(
    () => ({
      getNodes,
      onNodeRegister,
      onNodeUnregister,
      contentId,
      rootRef,
      triggerRef,
      isPointerInsideReactTreeRef,
      hoverCloseTimerRef,
      side,
      activationMode,
      delay,
      disabled,
    }),
    [
      getNodes,
      onNodeRegister,
      onNodeUnregister,
      contentId,
      side,
      activationMode,
      delay,
      disabled,
    ]
  );

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        ref: composedRefs,
        className: cn("relative flex flex-col items-end", className),
        onPointerDownCapture,
      },
      rootProps
    ),
    render,
    state: {
      slot: "speed-dial",
      state: getDataState(open),
      disabled,
    },
  });

  return (
    <StoreContext.Provider value={store}>
      <SpeedDialContext.Provider value={contextValue}>
        {element}
      </SpeedDialContext.Provider>
    </StoreContext.Provider>
  );
}

interface SpeedDialTriggerProps extends Omit<
  React.ComponentProps<typeof Button>,
  "onClick" | "onMouseEnter" | "onMouseLeave"
> {
  onClick?: (event: React.MouseEvent<TriggerElement>) => void;
  onMouseEnter?: (event: React.MouseEvent<TriggerElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<TriggerElement>) => void;
}

function SpeedDialTrigger(props: SpeedDialTriggerProps): React.ReactElement {
  const {
    onClick: onClickProp,
    onMouseEnter: onMouseEnterProp,
    onMouseLeave: onMouseLeaveProp,
    className,
    disabled: disabledProp,
    id,
    ref,
    ...triggerProps
  } = props;

  const store = useStoreContext(TRIGGER_NAME);

  const {
    onNodeRegister,
    onNodeUnregister,
    contentId,
    hoverCloseTimerRef,
    triggerRef,
    activationMode,
    delay,
    disabled,
  } = useSpeedDialContext(TRIGGER_NAME);

  const open = useStore((state) => state.open);
  const isDisabled = disabledProp === true || disabled;

  const instanceId = React.useId();
  const triggerId = id ?? instanceId;

  const composedRef = useMergedRefs(ref, triggerRef);
  const hoverOpenTimerRef = React.useRef<number | null>(null);

  useIsoLayoutEffect(() => {
    onNodeRegister({
      id: triggerId,
      ref: triggerRef,
      disabled: isDisabled,
    });

    return () => {
      onNodeUnregister(triggerId);
    };
  }, [onNodeRegister, onNodeUnregister, triggerId, isDisabled]);

  React.useEffect(() => {
    return () => {
      if (hoverOpenTimerRef.current) {
        window.clearTimeout(hoverOpenTimerRef.current);
      }
      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, [hoverCloseTimerRef]);

  const onClick = React.useCallback(
    (event: React.MouseEvent<TriggerElement>) => {
      onClickProp?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (hoverOpenTimerRef.current) {
        window.clearTimeout(hoverOpenTimerRef.current);
        hoverOpenTimerRef.current = null;
      }
      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }

      store.setOpen(!open);
    },
    [onClickProp, store, open, hoverCloseTimerRef]
  );

  const onMouseEnter = React.useCallback(
    (event: React.MouseEvent<TriggerElement>) => {
      onMouseEnterProp?.(event);
      if (event.defaultPrevented || activationMode !== "hover" || isDisabled) {
        return;
      }

      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }

      if (hoverOpenTimerRef.current) {
        window.clearTimeout(hoverOpenTimerRef.current);
      }

      hoverOpenTimerRef.current = window.setTimeout(() => {
        store.setOpen(true);
      }, delay);
    },
    [
      onMouseEnterProp,
      activationMode,
      isDisabled,
      store,
      delay,
      hoverCloseTimerRef,
    ]
  );

  const onMouseLeave = React.useCallback(
    (event: React.MouseEvent<TriggerElement>) => {
      onMouseLeaveProp?.(event);
      if (event.defaultPrevented || activationMode !== "hover" || isDisabled) {
        return;
      }

      if (hoverOpenTimerRef.current) {
        window.clearTimeout(hoverOpenTimerRef.current);
        hoverOpenTimerRef.current = null;
      }

      hoverCloseTimerRef.current = window.setTimeout(() => {
        store.setOpen(false);
      }, DEFAULT_HOVER_CLOSE_DELAY);
    },
    [onMouseLeaveProp, activationMode, isDisabled, store, hoverCloseTimerRef]
  );

  return (
    <Button
      aria-controls={contentId}
      aria-expanded={open}
      aria-haspopup="menu"
      className={cn(
        "size-12! rounded-full shadow-lg before:rounded-full",
        "[&_svg:not([class*='size-'])]:size-5!",
        className
      )}
      data-slot="speed-dial-trigger"
      data-state={getDataState(open)}
      disabled={isDisabled}
      id={triggerId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      ref={composedRef}
      size="icon"
      type="button"
      {...triggerProps}
    />
  );
}

interface SpeedDialItemImplContextValue {
  delay: number;
  open: boolean;
}

const SpeedDialItemImplContext =
  React.createContext<SpeedDialItemImplContextValue | null>(null);

function useSpeedDialItemImplContext(): SpeedDialItemImplContextValue | null {
  return React.useContext(SpeedDialItemImplContext);
}

interface SpeedDialItemImplProps {
  delay: number;
  open: boolean;
  children: React.ReactNode;
}

const SpeedDialItemImpl = React.memo(function SpeedDialItemImpl({
  delay,
  open,
  children,
}: SpeedDialItemImplProps) {
  const contextValue = React.useMemo<SpeedDialItemImplContextValue>(
    () => ({ delay, open }),
    [delay, open]
  );

  return (
    <SpeedDialItemImplContext.Provider value={contextValue}>
      {children}
    </SpeedDialItemImplContext.Provider>
  );
});

const speedDialContentVariants = cva(
  "absolute z-50 flex gap-(--speed-dial-gap) data-[state=closed]:pointer-events-none",
  {
    variants: {
      side: {
        top: "flex-col-reverse items-end",
        bottom: "flex-col items-end",
        left: "flex-row-reverse items-center",
        right: "flex-row items-center",
      },
    },
    defaultVariants: {
      side: "top",
    },
  }
);

interface SpeedDialContentProps
  extends DivProps, VariantProps<typeof speedDialContentVariants> {
  offset?: number;
  gap?: number;
  forceMount?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onInteractOutside?: (event: InteractOutsideEvent) => void;
}

function SpeedDialContent(
  props: SpeedDialContentProps
): React.ReactElement | null {
  const {
    offset = DEFAULT_OFFSET,
    gap = DEFAULT_GAP,
    forceMount = false,
    onEscapeKeyDown,
    onInteractOutside,
    onMouseEnter: onMouseEnterProp,
    onMouseLeave: onMouseLeaveProp,
    render,
    className,
    children,
    style,
    ref,
    ...contentProps
  } = props;

  const store = useStoreContext(CONTENT_NAME);
  const open = useStore((state) => state.open);

  const {
    contentId,
    side,
    getNodes,
    rootRef,
    triggerRef,
    isPointerInsideReactTreeRef,
    hoverCloseTimerRef,
    activationMode,
  } = useSpeedDialContext(CONTENT_NAME);

  const contentRef = React.useRef<ContentElement | null>(null);
  const composedRef = useMergedRefs(ref, contentRef);

  const propsRef = useLatestRef({
    onMouseEnter: onMouseEnterProp,
    onMouseLeave: onMouseLeaveProp,
    onEscapeKeyDown,
    onInteractOutside,
  });

  const orientation =
    side === "top" || side === "bottom" ? "vertical" : "horizontal";

  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [renderState, setRenderState] = React.useState({
    shouldRender: false,
    animating: false,
  });
  const [position, setPosition] = React.useState<React.CSSProperties>({});

  const openRafRef = React.useRef<number | null>(null);
  const unmountTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }

      setRenderState((prev) => ({ ...prev, shouldRender: true }));

      if (openRafRef.current) {
        cancelAnimationFrame(openRafRef.current);
      }
      const rafId = requestAnimationFrame(() => {
        setRenderState((prev) => ({ ...prev, animating: true }));
        openRafRef.current = null;
      });
      openRafRef.current = rafId;

      return () => {
        cancelAnimationFrame(rafId);
        openRafRef.current = null;
      };
    }

    setRenderState((prev) => ({ ...prev, animating: false }));

    if (forceMount) {
      return noop;
    }

    const childCount = React.Children.count(children);
    const longestDelay = Math.max(childCount - 1, 0) * DEFAULT_ITEM_DELAY;
    const totalDuration = longestDelay + DEFAULT_ANIMATION_DURATION;

    unmountTimerRef.current = window.setTimeout(() => {
      setRenderState((prev) => ({ ...prev, shouldRender: false }));
    }, totalDuration);

    return () => {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
  }, [open, forceMount, children]);

  const updatePosition = React.useCallback(() => {
    if (!(triggerRef.current && open)) {
      return;
    }

    const newPosition: React.CSSProperties = {};

    switch (side) {
      case "top":
        newPosition.bottom = `calc(100% + ${offset}px)`;
        newPosition.right = "0";
        break;
      case "bottom":
        newPosition.top = `calc(100% + ${offset}px)`;
        newPosition.right = "0";
        break;
      case "left":
        newPosition.right = `calc(100% + ${offset}px)`;
        newPosition.top = "0";
        break;
      case "right":
        newPosition.left = `calc(100% + ${offset}px)`;
        newPosition.top = "0";
        break;
    }

    setPosition((prev) =>
      prev.bottom === newPosition.bottom &&
      prev.left === newPosition.left &&
      prev.right === newPosition.right &&
      prev.top === newPosition.top
        ? prev
        : newPosition
    );
  }, [triggerRef, open, side, offset]);

  useIsoLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) {
      return noop;
    }

    const ownerDocument = contentRef.current?.ownerDocument ?? document;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        propsRef.current.onEscapeKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }
        store.setOpen(false);
      }

      if (event.key === "Tab") {
        const focusableElements = getNodes()
          .filter((node) => !node.disabled)
          .map((node) => node.ref.current)
          .filter((element): element is HTMLElement => element !== null);

        if (focusableElements.length === 0) {
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1);
        const activeElement = ownerDocument.activeElement;

        if (event.shiftKey) {
          if (activeElement === firstElement) {
            store.setOpen(false);
          }
        } else if (activeElement === lastElement) {
          store.setOpen(false);
        }
      }
    };

    ownerDocument.addEventListener("keydown", onKeyDown);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown);
  }, [open, propsRef, store, getNodes]);

  React.useEffect(() => {
    if (!open) {
      return noop;
    }

    const ownerDocument = contentRef.current?.ownerDocument ?? document;

    isPointerInsideReactTreeRef.current = false;
    let clickDismiss: (() => void) | null = null;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!isPointerInsideReactTreeRef.current) {
        const isOutside = rootRef.current?.contains(target) !== true;

        const onDismiss = () => {
          if (isOutside) {
            const interactEvent = new CustomEvent<InteractOutsideDetail>(
              INTERACT_OUTSIDE,
              {
                ...EVENT_OPTIONS,
                detail: { originalEvent: event },
              }
            );
            propsRef.current.onInteractOutside?.(interactEvent);
            if (interactEvent.defaultPrevented) {
              return;
            }
          }

          store.setOpen(false);
        };

        if (event.pointerType === "touch") {
          if (clickDismiss) {
            ownerDocument.removeEventListener("click", clickDismiss);
          }
          clickDismiss = onDismiss;
          ownerDocument.addEventListener("click", clickDismiss, { once: true });
        } else {
          onDismiss();
        }
      } else if (clickDismiss) {
        ownerDocument.removeEventListener("click", clickDismiss);
      }

      isPointerInsideReactTreeRef.current = false;
    };

    const timerId = window.setTimeout(() => {
      ownerDocument.addEventListener("pointerdown", onPointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timerId);
      ownerDocument.removeEventListener("pointerdown", onPointerDown);
      if (clickDismiss) {
        ownerDocument.removeEventListener("click", clickDismiss);
      }
    };
  }, [open, rootRef, isPointerInsideReactTreeRef, propsRef, store]);

  const onMouseEnter = React.useCallback(
    (event: React.MouseEvent<ContentElement>) => {
      propsRef.current.onMouseEnter?.(event);
      if (event.defaultPrevented || activationMode !== "hover") {
        return;
      }

      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    },
    [propsRef, hoverCloseTimerRef, activationMode]
  );

  const onMouseLeave = React.useCallback(
    (event: React.MouseEvent<ContentElement>) => {
      propsRef.current.onMouseLeave?.(event);
      if (event.defaultPrevented || activationMode !== "hover") {
        return;
      }

      hoverCloseTimerRef.current = window.setTimeout(() => {
        store.setOpen(false);
      }, DEFAULT_HOVER_CLOSE_DELAY);
    },
    [propsRef, hoverCloseTimerRef, store, activationMode]
  );

  const contentStyle = React.useMemo(() => {
    // SAFETY: React's `CSSProperties` does not model custom properties; the
    // stylesheet reads this variable by name.
    const styleWithVars = {
      "--speed-dial-gap": `${gap}px`,
      ...position,
      ...style,
    } as React.CSSProperties;
    return styleWithVars;
  }, [gap, position, style]);

  const processedChildren = React.useMemo(() => {
    const totalChildren = React.Children.count(children);
    return React.Children.map(children, (child, index) => {
      if (!React.isValidElement(child)) {
        return child;
      }

      const itemDelay = renderState.animating
        ? index * DEFAULT_ITEM_DELAY
        : (totalChildren - index - 1) * DEFAULT_ITEM_DELAY;

      return (
        <SpeedDialItemImpl
          delay={itemDelay}
          key={child.key ?? index}
          open={renderState.animating}
        >
          {child}
        </SpeedDialItemImpl>
      );
    });
  }, [children, renderState.animating]);

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        id: contentId,
        role: "menu",
        "aria-orientation": orientation,
        ref: composedRef,
        className: cn(speedDialContentVariants({ side, className })),
        style: contentStyle,
        onMouseEnter,
        onMouseLeave,
        children: processedChildren,
      },
      contentProps
    ),
    render,
    state: {
      slot: "speed-dial-content",
      state: getDataState(renderState.animating),
      orientation,
      side,
    },
  });

  const shouldMount = forceMount || renderState.shouldRender;

  if (!mounted || !shouldMount) {
    return null;
  }

  return element;
}

const speedDialItemVariants = cva(
  "flex items-center gap-1.5 transition-all [transition-delay:var(--speed-dial-delay)] duration-(--speed-dial-animation-duration) ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:opacity-0 data-[state=open]:translate-x-0 data-[state=open]:translate-y-0 data-[state=open]:opacity-100 motion-reduce:transition-none",
  {
    variants: {
      side: {
        top: "justify-end",
        bottom: "justify-end",
        left: "flex-row-reverse justify-start",
        right: "justify-start",
      },
    },
    compoundVariants: [
      {
        side: "top",
        className: "data-[state=closed]:translate-y-2",
      },
      {
        side: "bottom",
        className: "data-[state=closed]:-translate-y-2",
      },
      {
        side: "left",
        className: "data-[state=closed]:translate-x-2",
      },
      {
        side: "right",
        className: "data-[state=closed]:-translate-x-2",
      },
    ],
    defaultVariants: {
      side: "top",
    },
  }
);

interface SpeedDialItemContextValue {
  actionId: string;
  labelId: string;
}

const SpeedDialItemContext =
  React.createContext<SpeedDialItemContextValue | null>(null);

function useSpeedDialItemContext(
  consumerName: string
): SpeedDialItemContextValue {
  const context = React.useContext(SpeedDialItemContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ITEM_NAME}\``);
  }
  return context;
}

function SpeedDialItem(props: DivProps): React.ReactElement {
  const { render, className, style, children, ...itemProps } = props;

  const { side } = useSpeedDialContext(ITEM_NAME);
  const itemImplContext = useSpeedDialItemImplContext();
  const delay = itemImplContext?.delay ?? 0;
  const open = itemImplContext?.open ?? false;

  const actionId = React.useId();
  const labelId = React.useId();

  const contextValue = React.useMemo<SpeedDialItemContextValue>(
    () => ({ actionId, labelId }),
    [actionId, labelId]
  );

  const itemStyle = React.useMemo(() => {
    // SAFETY: React's `CSSProperties` does not model custom properties; the
    // stylesheet reads these variables by name.
    const styleWithVars = {
      "--speed-dial-animation-duration": `${DEFAULT_ANIMATION_DURATION}ms`,
      "--speed-dial-delay": `${delay}ms`,
      ...style,
    } as React.CSSProperties;
    return styleWithVars;
  }, [delay, style]);

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "none",
        className: cn(speedDialItemVariants({ side, className })),
        style: itemStyle,
        children,
      },
      itemProps
    ),
    render,
    state: {
      slot: "speed-dial-item",
      state: getDataState(open),
      side,
    },
  });

  return (
    <SpeedDialItemContext.Provider value={contextValue}>
      {element}
    </SpeedDialItemContext.Provider>
  );
}

interface SpeedDialActionProps extends Omit<
  React.ComponentProps<typeof Button>,
  "onSelect" | "onClick"
> {
  onSelect?: (event: Event) => void;
  onClick?: (event: React.MouseEvent<ActionElement>) => void;
}

function SpeedDialAction(props: SpeedDialActionProps): React.ReactElement {
  const {
    onSelect,
    onClick: onClickProp,
    className,
    disabled,
    id,
    ref,
    ...actionProps
  } = props;

  const propsRef = useLatestRef({
    onClick: onClickProp,
    onSelect,
  });

  const store = useStoreContext(ACTION_NAME);

  const { onNodeRegister, onNodeUnregister } = useSpeedDialContext(ACTION_NAME);
  const { actionId: itemActionId, labelId } =
    useSpeedDialItemContext(ACTION_NAME);

  const actionId = id ?? itemActionId;

  const actionRef = React.useRef<ActionElement | null>(null);
  const composedRefs = useMergedRefs(ref, actionRef);

  useIsoLayoutEffect(() => {
    onNodeRegister({
      id: actionId,
      ref: actionRef,
      disabled: disabled === true,
    });

    return () => {
      onNodeUnregister(actionId);
    };
  }, [onNodeRegister, onNodeUnregister, actionId, disabled]);

  const onClick = React.useCallback(
    (event: React.MouseEvent<ActionElement>) => {
      propsRef.current.onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const action = actionRef.current;
      if (!action) {
        return;
      }

      const actionSelectEvent = new CustomEvent(ACTION_SELECT, EVENT_OPTIONS);

      action.addEventListener(
        ACTION_SELECT,
        (selectEvent) => propsRef.current.onSelect?.(selectEvent),
        { once: true }
      );

      action.dispatchEvent(actionSelectEvent);
      if (actionSelectEvent.defaultPrevented) {
        return;
      }

      store.setOpen(false);
    },
    [propsRef, store]
  );

  return (
    <Button
      aria-labelledby={labelId}
      className={cn(
        "size-11! shrink-0 rounded-full shadow-md before:rounded-full",
        "[&_svg:not([class*='size-'])]:size-4.5!",
        className
      )}
      data-slot="speed-dial-action"
      disabled={disabled}
      id={actionId}
      onClick={onClick}
      ref={composedRefs}
      role="menuitem"
      size="icon"
      type="button"
      variant="outline"
      {...actionProps}
    />
  );
}

function SpeedDialLabel(props: DivProps): React.ReactElement {
  const { render, className, ...labelProps } = props;
  const { labelId } = useSpeedDialItemContext(LABEL_NAME);

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        id: labelId,
        className: cn(
          "bg-popover text-popover-foreground pointer-events-none rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md/5 select-none not-dark:bg-clip-padding",
          className
        ),
      },
      labelProps
    ),
    render,
    state: {
      slot: "speed-dial-label",
    },
  });
}

export {
  SpeedDial,
  SpeedDialAction,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  type SpeedDialProps,
  SpeedDialTrigger,
};
