import { type RouteSectionProps } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { IconPlaceholder } from "../components/ui/icon-placeholder";

export function RootComponent(props: RouteSectionProps) {
  const [isOpen, setIsOpen] = createSignal(true);

  const handleClose = () => {
    setIsOpen(false);
    if (window.parent !== window) {
      window.parent.postMessage({ event: "CLOSE" }, "*");
    }
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
            <button
              aria-label="Close"
              class="absolute top-5 right-5 z-50 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={handleClose}
              type="button"
            >
              <IconPlaceholder class="size-5" />
            </button>

            {/* Content */}
            <main class="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
              {props.children}
            </main>
          </div>
        </div>
      </div>
    </Show>
  );
}
