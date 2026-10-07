import type { RouteSectionProps } from "@solidjs/router";
import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  createSignal,
  ErrorBoundary,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";

import { Button } from "../components/ui/button";
import { ErrorFallback } from "../components/ui/error-fallback";
import { Icon } from "../components/ui/icon";
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

  const handleParentMessage = (message: ParentMessage) => {
    switch (message.event) {
      case "SHOW":
        setIsOpen(true);
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
      <div
        class="bg-popover text-popover-foreground flex h-full min-h-full w-full flex-col"
        data-feeblo-widget-container
      >
        <div class="absolute top-5 right-5 z-10">
          <Button
            aria-label="Close"
            onClick={handleClose}
            size="icon-lg"
            variant="ghost"
          >
            <Icon name="Cancel01Icon" />
          </Button>
        </div>

        <main class="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
          <ErrorBoundary fallback={(err) => <ErrorFallback error={err} />}>
            {/*
             * Route components read `createAsync` data. Without a boundary
             * Solid renders `undefined` on the first pass and each route's
             * not-found fallback flashes (or, on a cold load, sits there)
             * until the request resolves. With one, navigation runs in a
             * transition and the previous screen is held until the next
             * route is ready; the skeleton only shows on first load.
             */}
            <Suspense fallback={<WidgetLoading />}>{props.children}</Suspense>
          </ErrorBoundary>
        </main>

        <Show when={config.mode === "hub"}>
          <nav
            aria-label="Feeblo Hub modules"
            class="bg-popover/95 z-10 m-3 mt-0 flex shrink-0 gap-1 rounded-xl border p-1 shadow-lg backdrop-blur"
          >
            <For each={config.modules}>
              {(module) => (
                <A
                  aria-current={
                    moduleForPath(location.pathname) === module
                      ? "page"
                      : undefined
                  }
                  class="text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-foreground aria-[current=page]:text-background flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors"
                  href={module === "updates" ? "/updates" : "/"}
                >
                  <span aria-hidden="true">
                    {module === "feedback" ? "✦" : "◫"}
                  </span>
                  {module === "feedback" ? "Feedback" : "Updates"}
                </A>
              )}
            </For>
          </nav>
        </Show>
      </div>
    </Show>
  );
}

function WidgetLoading() {
  return (
    <div class="p-6" role="status">
      <span class="sr-only">Loading…</span>
      <div
        aria-hidden="true"
        class="bg-muted h-5 w-40 animate-pulse rounded-md"
      />
      <div
        aria-hidden="true"
        class="bg-muted mt-3 h-3.5 w-56 animate-pulse rounded-full"
      />
      <div
        aria-hidden="true"
        class="bg-muted mt-6 h-14 w-full animate-pulse rounded-lg"
      />
      <div
        aria-hidden="true"
        class="bg-muted mt-3 h-14 w-full animate-pulse rounded-lg"
      />
    </div>
  );
}
