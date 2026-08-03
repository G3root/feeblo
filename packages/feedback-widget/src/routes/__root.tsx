import type { RouteSectionProps } from "@solidjs/router";
import { useNavigate } from "@solidjs/router";
import {
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ErrorFallback } from "../components/error-fallback";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
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

  const handleParentMessage = (message: ParentMessage) => {
    // biome-ignore lint/style/useDefaultSwitchClause: <explanation>
    switch (message.event) {
      case "SHOW":
        setIsOpen(true);
        sendToParent({ event: "WIDGET_OPENED" });
        break;
      case "HIDE":
        setIsOpen(false);
        sendToParent({ event: "WIDGET_CLOSED" });
        break;
      case "SET_CONTEXT":
        setWidgetContext(message.data);
        break;
      case "SET_BOARD":
        if (message.data?.board) {
          navigate(`/board/${message.data.board}`);
        }
        break;
      case "SET_LOCALE":
        document.documentElement.lang = message.data.locale;
        break;
      case "IDENTIFY":
        setWidgetIdentity(message.data);
        sendToParent({ event: "IDENTITY_CHANGED", data: message.data });
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
        class="flex h-full min-h-full w-full flex-col bg-popover text-popover-foreground"
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
            {props.children}
          </ErrorBoundary>
        </main>
      </div>
    </Show>
  );
}
