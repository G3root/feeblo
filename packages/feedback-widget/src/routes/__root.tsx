import type { RouteSectionProps } from "@solidjs/router";
import { useNavigate } from "@solidjs/router";
import { createSignal, ErrorBoundary, onCleanup, onMount, Show } from "solid-js";
import { ErrorFallback } from "../components/error-fallback";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";

type ParentMessage =
  | { event: "SHOW" }
  | { event: "HIDE" }
  | { event: "SET_BOARD"; data: { board: string } };

export function RootComponent(props: RouteSectionProps) {
  const [isOpen, setIsOpen] = createSignal(true);
  const navigate = useNavigate();

  const sendToParent = (message: unknown) => {
    if (window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  };

  onMount(() => {
    sendToParent({ event: "READY" });
  });

  const handleParentMessage = (e: MessageEvent<unknown>) => {
    const message = e.data as ParentMessage;
    if (!message || typeof message !== "object" || !("event" in message)) {
      return;
    }

    switch (message.event) {
      case "SHOW":
        setIsOpen(true);
        sendToParent({ event: "WIDGET_OPENED" });
        break;
      case "HIDE":
        setIsOpen(false);
        break;
      case "SET_BOARD":
        if (message.data?.board) {
          navigate(`/board/${message.data.board}`);
        }
        break;
      default:
        break;
    }
  };

  onMount(() => {
    window.addEventListener("message", handleParentMessage);
  });

  onCleanup(() => {
    window.removeEventListener("message", handleParentMessage);
  });

  const handleClose = () => {
    setIsOpen(false);
    sendToParent({ event: "CLOSE" });
  };

  return (
    <Show when={isOpen()}>
      <div
        class="fixed inset-0 z-[999999999]"
        data-feeblo-widget-container
        style={{ "pointer-events": "none" }}
      >
        {/* Backdrop */}
        <button
          aria-label="Close"
          class="fade-in fixed inset-0 z-40 animate-in bg-black/30 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
          onClick={handleClose}
          style={{ "pointer-events": "auto" }}
          type="button"
        />

        {/* Modal */}
        <div
          class="fade-in slide-in-from-right animation-duration-300 fixed inset-0 z-50 flex animate-in items-center justify-center p-0 sm:inset-auto sm:top-4 sm:right-4 sm:bottom-4 sm:left-auto sm:w-[400px]"
          id="feeblo-modal"
          style={{ "pointer-events": "auto" }}
        >
          <div class="relative flex h-full w-full max-w-md flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-4xl dark:ring-foreground/10">
            {/* Close */}
            <div class="absolute top-5 right-5">
              <Button
                aria-label="Close"
                onClick={handleClose}
                size="icon-lg"
                variant="ghost"
              >
                <Icon name="Cancel01Icon" />
              </Button>
            </div>

            {/* Content */}
            <main class="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
              <ErrorBoundary fallback={(err) => <ErrorFallback error={err} />}>
                {props.children}
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </div>
    </Show>
  );
}
