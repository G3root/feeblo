import type { RouteSectionProps } from "@solidjs/router";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";

import { ViewSkeleton } from "../components/shell/view-skeleton";
import { WidgetShell } from "../components/shell/widget-shell";
import { ErrorFallback } from "../components/ui/error-fallback";
import { fetchBoards, fetchUpdates } from "../lib/api";
import { getWidgetConfig, moduleForPath } from "../lib/config";
import { setWidgetContext } from "../lib/context";
import { setWidgetIdentity } from "../lib/identity";
import {
  type ParentMessage,
  sendToParent,
  subscribeToParentMessages,
} from "../lib/messages";

export function RootComponent(props: RouteSectionProps) {
  const [isOpen, setIsOpen] = createSignal(true);
  const navigate = useNavigate();
  const location = useLocation();
  const config = getWidgetConfig();
  let warmed = false;

  /**
   * Start the configured surfaces' first reads the moment the visitor opens
   * the widget. The router's query cache then answers the first paint of the
   * surface they land on, and a tab switch within the same visit resolves
   * without a cold request.
   */
  const warmModuleData = () => {
    if (warmed) return;
    warmed = true;
    if (config.modules.includes("feedback")) {
      void fetchBoards().catch(() => undefined);
    }
    if (config.modules.includes("updates")) {
      void fetchUpdates().catch(() => undefined);
    }
  };

  const handleParentMessage = (message: ParentMessage) => {
    switch (message.event) {
      case "SHOW":
        setIsOpen(true);
        warmModuleData();
        sendToParent({
          event: "WIDGET_OPENED",
          data: { module: moduleForPath(location.pathname) },
        });
        break;
      case "HIDE":
        setIsOpen(false);
        break;
      case "SET_CONTEXT":
        setWidgetContext(message.data);
        break;
      case "SET_MODULE":
        if (config.modules.includes(message.data.module)) {
          navigate(message.data.module === "updates" ? "/updates" : "/");
        }
        break;
      case "SET_BOARD":
        if (config.modules.includes("feedback") && message.data?.board) {
          navigate(`/board/${message.data.board}`);
        }
        break;
      case "SET_LOCALE":
        document.documentElement.lang = message.data.locale;
        break;
      case "IDENTIFY":
        setWidgetIdentity(message.data);
        {
          const { token: _token, ...publicIdentity } = message.data;
          sendToParent({ event: "IDENTITY_CHANGED", data: publicIdentity });
        }
        break;
    }
  };

  onMount(() => {
    const unsubscribe = subscribeToParentMessages(handleParentMessage);
    onCleanup(unsubscribe);
    sendToParent({ event: "READY" });
  });

  const handleClose = () => {
    setIsOpen(false);
    sendToParent({ event: "CLOSE" });
  };

  return (
    <Show when={isOpen()}>
      <WidgetShell onClose={handleClose}>
        <ErrorBoundary fallback={(error) => <ErrorFallback error={error} />}>
          {/*
           * This boundary holds the frame while a route's chunk loads. Each
           * route opens its own boundary for its data, so the skeleton it
           * shows is the shape of the view being loaded; this one only shows
           * on a cold start, before a view exists.
           */}
          <Suspense fallback={<ViewSkeleton />}>{props.children}</Suspense>
        </ErrorBoundary>
      </WidgetShell>
    </Show>
  );
}
