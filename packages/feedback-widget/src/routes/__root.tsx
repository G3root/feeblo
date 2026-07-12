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
        break;
      case "SET_BOARD":
        if (message.data?.board) {
          navigate(`/board/${message.data.board}`);
        }
        break;
      case "IDENTIFY":
        setWidgetIdentity({
          id: message.data.id,
          name: message.data.name,
          email: message.data.email,
          avatar: message.data.avatar,
          companies: message.data.companies,
          token: message.data.token,
        });
        break;
    }
  };

  onMount(() => {
    sendToParent({ event: "READY" });
  });

  onMount(() => {
    const unsubscribe = subscribeToParentMessages(handleParentMessage);
    onCleanup(unsubscribe);
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
