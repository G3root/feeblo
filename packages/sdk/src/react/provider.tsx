import * as React from "react";

import { subscribe } from "../events";
import { getCurrentEmbed, getCurrentWidget, init } from "../instance";
import type {
  EmbedOptions,
  FeebloWidget,
  UserIdentity,
  WidgetMode,
  WidgetModule,
  WidgetPlacement,
} from "../types";
import { FeebloContext, type FeebloContextValue } from "./context";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FeebloProviderProps {
  readonly baseUrl?: string | undefined;
  readonly children?: React.ReactNode;
  readonly containerStyles?: Partial<CSSStyleDeclaration> | undefined;
  readonly debug?: boolean | undefined;
  readonly defaultBoard?: string | undefined;
  readonly locale?: string | undefined;
  readonly mode?: WidgetMode | undefined;
  readonly modules?: WidgetModule[] | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly onError?: EmbedOptions["onError"] | undefined;
  readonly onHeightChange?: ((height: number) => void) | undefined;
  readonly onReady?: (() => void) | undefined;
  readonly organizationId: string;
  readonly placement?: WidgetPlacement | undefined;
  readonly root?: HTMLElement | undefined;
  readonly theme?: string | undefined;
  readonly user?: UserIdentity | null | undefined;
}

// ---------------------------------------------------------------------------
// Helpers — keep init options stable (rerender-dependencies: primitive deps)
// ---------------------------------------------------------------------------

type InitOptions = Omit<EmbedOptions, "user">;

function useInitOptions(props: Omit<FeebloProviderProps, "organizationId" | "user" | "children" | "onReady">): InitOptions {
  const {
    baseUrl,
    containerStyles,
    debug,
    defaultBoard,
    locale,
    mode,
    modules,
    onClose,
    onError,
    onHeightChange,
    placement,
    root,
    theme,
  } = props;

  // Serialize modules to a primitive for stable deps (js-set-map-lookups)
  const modulesKey = React.useMemo(() => modules?.join(",") ?? "", [modules]);
  const memoizedModules = React.useMemo(() => modules, [modulesKey]);

  // Memoise containerStyles by JSON — avoids object identity churn
  const containerStylesKey = React.useMemo(
    () => (containerStyles ? JSON.stringify(containerStyles) : ""),
    [containerStyles],
  );
  const memoizedContainerStyles = React.useMemo(
    () => (containerStylesKey ? (JSON.parse(containerStylesKey) as Partial<CSSStyleDeclaration>) : undefined),
    [containerStylesKey],
  );

  return React.useMemo<InitOptions>(
    () => ({
      ...(baseUrl !== undefined && { baseUrl }),
      ...(memoizedContainerStyles !== undefined && { containerStyles: memoizedContainerStyles }),
      ...(debug !== undefined && { debug }),
      ...(defaultBoard !== undefined && { defaultBoard }),
      ...(locale !== undefined && { locale }),
      ...(mode !== undefined && { mode }),
      ...(memoizedModules !== undefined && { modules: memoizedModules }),
      ...(onClose !== undefined && { onClose }),
      ...(onError !== undefined && { onError }),
      ...(onHeightChange !== undefined && { onHeightChange }),
      ...(placement !== undefined && { placement }),
      ...(root !== undefined && { root }),
      ...(theme !== undefined && { theme }),
    }),
    [
      baseUrl,
      memoizedContainerStyles,
      debug,
      defaultBoard,
      locale,
      mode,
      memoizedModules,
      onClose,
      onError,
      onHeightChange,
      placement,
      root,
      theme,
    ],
  );
}

// Serialize user to a primitive key to avoid effect churn on object identity.
// Uses JSON.stringify — cheap vs. deep-equal and preserves placement of null.
function useUserKey(user: UserIdentity | null | undefined): string {
  return React.useMemo(() => {
    if (!user) return "";
    // Exclude token from key if you want to avoid re-identifying on token refresh?
    // Keep full identity for correctness — token changes must propagate.
    try {
      return JSON.stringify(user);
    } catch {
      return user.id;
    }
  }, [user]);
}

let activeProviderCount = 0;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function FeebloProvider(props: FeebloProviderProps): React.ReactElement {
  const { organizationId, user, children, onReady } = props;
  const initOptions = useInitOptions(props);
  const userKey = useUserKey(user);

  const [widget, setWidget] = React.useState<FeebloWidget | null>(null);
  const [isReady, setIsReady] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);

  // Transient refs — avoids subscribing to state only used in callbacks (rerender-defer-reads)
  const widgetRef = React.useRef<FeebloWidget | null>(null);
  const onReadyRef = React.useRef(onReady);
  onReadyRef.current = onReady;

  // --- Lifecycle: init / destroy ------------------------------------------
  // Cheap sync condition before awaiting / doing work (async-cheap-condition-before-await)
  // We guard on missing org id and non-browser before calling init.
  React.useEffect(() => {
    if (!organizationId) {
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let cancelled = false;
    if (!getCurrentEmbed()) {
      activeProviderCount = 0;
    }
    activeProviderCount += 1;

    let w: FeebloWidget;
    const existingEmbed = getCurrentEmbed();
    if (activeProviderCount > 1 && existingEmbed) {
      const shared = getCurrentWidget();
      w = shared ?? init(organizationId, {
        ...initOptions,
        ...(user ? { user } : {}),
      });
    } else {
      w = init(organizationId, {
        ...initOptions,
        ...(user ? { user } : {}),
      });
    }

    widgetRef.current = w;
    if (!cancelled) {
      setWidget(w);
    }

    const offReady = subscribe("widgetReady", () => {
      if (cancelled) return;
      setIsReady(true);
      onReadyRef.current?.();
    });
    const offOpened = subscribe("widgetOpened", () => {
      if (cancelled) return;
      setIsOpen(true);
    });
    const offClosed = subscribe("widgetClosed", () => {
      if (cancelled) return;
      setIsOpen(false);
    });

    return () => {
      cancelled = true;
      offReady();
      offOpened();
      offClosed();
      activeProviderCount = Math.max(0, activeProviderCount - 1);
      const isLastProvider = activeProviderCount === 0;
      // Only the last mounted provider owns the singleton's lifecycle.
      // This prevents a provider sharing an embed from destroying it for
      // the other, and avoids a stale destroy() removing a newer
      // singleton's container (same ID) via destroyInstance.
      if (isLastProvider && widgetRef.current === w) {
        w.destroy();
        widgetRef.current = null;
      }
      setWidget((prev) => (prev === w && isLastProvider ? null : prev));
      if (isLastProvider) {
        setIsReady(false);
        setIsOpen(false);
      }
    };
    // initOptions is memoised; organizationId is primitive; user intentionally
    // excluded — identity sync is handled separately to avoid re-creating the
    // iframe when only the user changes (server-parallel-fetching / rerender-split-combined-hooks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, initOptions]);

  // --- Identity sync — separate effect with independent deps ----------------
  // (rerender-split-combined-hooks)
  React.useEffect(() => {
    if (!widgetRef.current) return;
    if (!userKey) {
      const current = getCurrentEmbed();
      if (current?.getAutoLoginToken()) {
        current.clearIdentity();
      }
      return;
    }
    try {
      const parsed = JSON.parse(userKey) as UserIdentity;
      widgetRef.current.identify(parsed);
    } catch {
      // Fallback: userKey was user.id
      if (user) widgetRef.current.identify(user);
    }
  }, [userKey, user]);

  // --- Stable callbacks (rerender-functional-setstate / advanced-event-handler-refs) ---
  const open = React.useCallback<FeebloContextValue["open"]>(
    (trigger, metadata) => {
      widgetRef.current?.open(trigger, metadata);
    },
    [],
  );

  const close = React.useCallback(() => {
    widgetRef.current?.close();
  }, []);

  const identify = React.useCallback<FeebloContextValue["identify"]>(
    (nextUser) => {
      widgetRef.current?.identify(nextUser);
    },
    [],
  );

  const setBoard = React.useCallback<FeebloContextValue["setBoard"]>(
    (board) => {
      widgetRef.current?.setBoard(board);
    },
    [],
  );

  const metadata = React.useCallback<FeebloContextValue["metadata"]>(
    (patch) => {
      widgetRef.current?.metadata(patch);
    },
    [],
  );

  const openModule = React.useCallback<FeebloContextValue["openModule"]>(
    (module) => {
      widgetRef.current?.openModule(module);
    },
    [],
  );

  const contextValue = React.useMemo<FeebloContextValue>(
    () => ({
      widget,
      isReady,
      isOpen,
      organizationId,
      open,
      close,
      identify,
      setBoard,
      metadata,
      openModule,
    }),
    [widget, isReady, isOpen, organizationId, open, close, identify, setBoard, metadata, openModule],
  );

  return (
    <FeebloContext.Provider value={contextValue}>
      {children}
    </FeebloContext.Provider>
  );
}
