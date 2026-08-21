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
   * active until another `identify` call or a full remount. */
  user?: UserIdentity | undefined;
}

/**
 * Fields that require tearing down and recreating the underlying embed when
 * they change. Deliberately excludes `user` (handled by `identify`), the
 * event callbacks (read through refs), and `root` (compared by reference in
 * the effect dependencies below — DOM elements do not serialize).
 */
function configKeyOf(props: FeebloProviderProps): string {
  return JSON.stringify([
    props.organizationId,
    props.baseUrl,
    props.containerStyles,
    props.debug,
    props.defaultBoard,
    props.locale,
    props.mode,
    props.modules,
    props.placement,
    props.theme,
  ]);
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

  useEffect(() => {
    closeRef.current = props.onClose;
  });
  useEffect(() => {
    errorRef.current = props.onError;
  });
  useEffect(() => {
    heightRef.current = props.onHeightChange;
  });

  const handleSelfClose = useCallback(() => {
    closeRef.current?.();
  }, []);
  const handleError = useCallback((error: EmbedError) => {
    errorRef.current?.(error);
  }, []);
  const handleHeightChange = useCallback((height: number) => {
    heightRef.current?.(height);
  }, []);

  const configKey = configKeyOf(props);

  useEffect(() => {
    const options: EmbedOptions = {
      baseUrl: props.baseUrl,
      containerStyles: props.containerStyles,
      debug: props.debug,
      defaultBoard: props.defaultBoard,
      locale: props.locale,
      mode: props.mode,
      modules: props.modules,
      onClose: handleSelfClose,
      onError: handleError,
      onHeightChange: handleHeightChange,
      placement: props.placement,
      root: props.root,
      theme: props.theme,
    };
    const next = Feeblo.init(props.organizationId, options);
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
  }, [configKey, props.root]);

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
