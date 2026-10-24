import { FeebloProvider, useFeeblo } from "@feeblo/sdk-react";
import { useTheme } from "@feeblo/ui/theme-provider";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import { useEffect, useRef } from "react";

interface FeedbackWidgetEmbedProps {
  /** Increments on every click of the sidebar trigger; opens the widget. */
  openRequests: number;
  organizationId: string;
}

/**
 * Where the panel sits: the same bottom-right box the SDK's own launcher
 * placement produces, without the launcher and without relying on a trigger.
 *
 * The SDK's default is `top: 0; left: 0` because it expects `open(trigger)` to
 * hand it an element to anchor to, and the React bindings' `open()` takes no
 * arguments. Left alone, the panel would cover the top of the sidebar.
 */
const CONTAINER_STYLES: Partial<CSSStyleDeclaration> = {
  bottom: "20px",
  left: "auto",
  maxHeight: "min(600px, calc(100vh - 40px))",
  maxWidth: "calc(100vw - 32px)",
  right: "20px",
  top: "auto",
};

/**
 * The SDK itself, kept in its own chunk (see `feedback-widget.tsx`) so the
 * dashboard shell never pays for it until someone asks for the widget.
 */
export default function FeedbackWidgetEmbed({
  openRequests,
  organizationId,
}: FeedbackWidgetEmbedProps) {
  const { resolvedTheme } = useTheme();
  // The dashboard and the widget's iframe are the same deployment, so the
  // page's own origin is the host to embed from. This only ever runs in the
  // browser; the guard covers a module evaluated during a build.
  const baseUrl = hasWindow() ? window.location.origin : undefined;

  return (
    <FeebloProvider
      baseUrl={baseUrl}
      containerStyles={CONTAINER_STYLES}
      organizationId={organizationId}
      theme={resolvedTheme}
    >
      <OpenWidget openRequests={openRequests} />
    </FeebloProvider>
  );
}

/**
 * Opens the widget the provider above mounts, once per click. Renders nothing:
 * the SDK owns its own DOM.
 *
 * Waits for `isReady` because a child's effect runs before the provider's, so
 * on the first mount `open` has no widget to act on yet. The ref is what keeps
 * a re-mount — a theme change recreates the embed, and its widget — from
 * reopening a widget the user had closed.
 */
function OpenWidget({ openRequests }: { openRequests: number }) {
  const { isReady, open } = useFeeblo();
  const openedFor = useRef(0);

  useEffect(() => {
    if (!isReady || openedFor.current === openRequests) {
      return;
    }
    openedFor.current = openRequests;
    open();
  }, [isReady, open, openRequests]);

  return null;
}
