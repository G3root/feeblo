import {
  Feeblo,
  type EmbedError,
  type EmbedOptions,
  type FeebloWidget,
  type UserIdentity,
  type WidgetMode,
  type WidgetModule,
  type WidgetPlacement,
} from "@feeblo/sdk";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FeebloContext, type FeebloContextValue } from "./context";

/**
 * Props accepted by {@link FeebloProvider}.
 *
 * - Config fields (`organizationId`, `theme`, `mode`, …) recreate the widget
 *   whenever they change.
 * - `user` re-identifies the current widget without recreating it.
 * - Callbacks are read through refs, so passing inline closures never
 *   triggers a re-initialization and the widget always invokes the latest one.
 */
export interface FeebloProviderProps {
  /** Widget host override. Defaults to the SDK's own resolution rules. */
  baseUrl?: string | undefined;
  children?: ReactNode | undefined;
  containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  debug?: boolean | undefined;
  defaultBoard?: string | undefined;
  locale?: string | undefined;
  mode?: WidgetMode | undefined;
  modules?: WidgetModule[] | undefined;
  onClose?: (() => void) | undefined;
  onError?: ((error: EmbedError) => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
  /** The Feeblo organization whose widget should be mounted. */
  organizationId: string;
  placement?: WidgetPlacement | undefined;
  root?: HTMLElement | undefined;
  theme?: string | undefined;
  /** Identify the current user; changes call `identify` on the live widget.
   * Setting `user` back to `undefined` does not sign the widget out — the SDK
   * has no clear-identity API, so the last identified user (and token) stays
   * active until another `identify` call. The latest identity survives config
   * and root recreation; only unmounting the provider discards it. */
  user?: UserIdentity | undefined;
}

export function FeebloProvider(props: FeebloProviderProps): ReactNode {
  const { children, user } = props;

  const [widget, setWidget] = useState<FeebloWidget | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Latest-ref seams for the callbacks handed to the SDK at init time. The
  // embed captures these wrappers once; the refs keep them pointing at the
  // newest props without re-creating the widget.
  const closeRef = useRef(props.onClose);
  const errorRef = useRef(props.onError);
  const heightRef = useRef(props.onHeightChange);

  // Last known identity, so a widget recreated by a config or root change is
  // re-identified without waiting for a new `user` prop or imperative call.
  // The SDK has no clear-identity API, so only the latest non-undefined
  // identity is meaningful.
  const identityRef = useRef<UserIdentity | undefined>(undefined);

  // Single pass: keep all SDK callback seams pointing at the latest props
  // without re-creating the widget.
  useEffect(() => {
    closeRef.current = props.onClose;
    errorRef.current = props.onError;
    heightRef.current = props.onHeightChange;
  }, []);

  const handleSelfClose = useCallback(() => {
    closeRef.current?.();
  }, []);
  const handleError = useCallback((error: EmbedError) => {
    errorRef.current?.(error);
  }, []);
  const handleHeightChange = useCallback((height: number) => {
    heightRef.current?.(height);
  }, []);

  // Serialized key for the fields that require tearing down and recreating
  // the underlying embed when they change. Deliberately excludes `user`
  // (handled by `identify`), the event callbacks (read through refs), and
  // compares `root` by reference below — DOM elements do not serialize.
  // Memoized: stringifying ten fields (including objects like
  // `containerStyles`) on every render allocates for nothing when props are
  // referentially stable. Callers should still stabilize object props.
  const {
    organizationId,
    baseUrl,
    containerStyles,
    debug,
    defaultBoard,
    locale,
    mode,
    modules,
    placement,
    theme,
    root,
  } = props;
  const configKey = useMemo(
    () =>
      JSON.stringify([
        organizationId,
        baseUrl,
        containerStyles,
        debug,
        defaultBoard,
        locale,
        mode,
        modules,
        placement,
        theme,
      ]),
    [
      organizationId,
      baseUrl,
      containerStyles,
      debug,
      defaultBoard,
      locale,
      mode,
      modules,
      placement,
      theme,
    ]
  );

  useEffect(() => {
    const options: EmbedOptions = {
      baseUrl,
      containerStyles,
      debug,
      defaultBoard,
      locale,
      mode,
      modules,
      onClose: handleSelfClose,
      onError: handleError,
      onHeightChange: handleHeightChange,
      placement,
      root,
      theme,
    };
    const next = Feeblo.init(organizationId, options);
    // Replay the remembered identity onto the fresh embed; without this an
    // imperative identify() would be lost across recreation.
    if (identityRef.current !== undefined) {
      next.identify(identityRef.current);
    }
    setWidget(next);

    return () => {
      setWidget(null);
      setIsReady(false);
      setIsOpen(false);
      next.destroy();
    };
    // Re-created only when the serialized config or the root element changes;
    // callback identities are irrelevant because they are consumed through
    // stable ref wrappers. `root` must be compared by reference: DOM elements
    // all serialize identically, so it cannot live in the config key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, root]);

  // Mirror the widget's lifecycle events into reactive state so consumers can
  // render off `isReady`/`isOpen` without subscribing manually.
  useEffect(() => {
    const unsubscribeReady = Feeblo.on("widgetReady", () => {
      setIsReady(true);
    });
    const unsubscribeOpened = Feeblo.on("widgetOpened", () => {
      setIsOpen(true);
    });
    const unsubscribeClosed = Feeblo.on("widgetClosed", () => {
      setIsOpen(false);
    });

    return () => {
      unsubscribeReady();
      unsubscribeOpened();
      unsubscribeClosed();
    };
  }, []);

  // Keep the widget's identity in sync with the `user` prop.
  useEffect(() => {
    if (widget === null || user === undefined) {
      return;
    }
    identityRef.current = user;
    widget.identify(user);
  }, [widget, user]);

  // The handle lives in a ref so actions stay referentially stable even while
  // the underlying embed is being recreated behind a config change.
  const widgetRef = useRef<FeebloWidget | null>(null);
  useEffect(() => {
    widgetRef.current = widget;
  }, [widget]);

  const open = useCallback(() => {
    const widget = widgetRef.current;
    if (!widget) {
      return;
    }
    widget.open();
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    widgetRef.current?.close();
    setIsOpen(false);
  }, []);
  const openModule = useCallback((module: WidgetModule) => {
    const widget = widgetRef.current;
    if (!widget) {
      return;
    }
    widget.openModule(module);
    setIsOpen(true);
  }, []);
  const setBoard = useCallback((board: string) => {
    widgetRef.current?.setBoard(board);
  }, []);
  const identify = useCallback((identity: UserIdentity) => {
    identityRef.current = identity;
    widgetRef.current?.identify(identity);
  }, []);
  const metadata = useCallback((patch: Record<string, string | null>) => {
    widgetRef.current?.metadata(patch);
  }, []);

  const value = useMemo<FeebloContextValue>(
    () => ({
      close,
      identify,
      isOpen,
      isReady,
      metadata,
      open,
      openModule,
      setBoard,
    }),
    [close, identify, isOpen, isReady, metadata, open, openModule, setBoard]
  );

  return (
    <FeebloContext.Provider value={value}>{children}</FeebloContext.Provider>
  );
}
