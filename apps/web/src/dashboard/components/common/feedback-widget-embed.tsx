import {
  FeebloProvider,
  useFeeblo,
  type UserIdentity,
} from "@feeblo/sdk-react";
import { useTheme } from "@feeblo/ui/theme-provider";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useEffect, useRef, useState } from "react";

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
  const user = useWidgetIdentity(openRequests);
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
      user={user}
    >
      <OpenWidget openRequests={openRequests} />
    </FeebloProvider>
  );
}

/**
 * The signed-in user, identified with a freshly minted SSO token.
 *
 * Without it the widget accepts the feedback anonymously: the token only says
 * who to file it under, so a deployment with no widget workspace configured,
 * or a workspace whose signing secret was never generated, keeps a usable
 * widget instead of a broken button. Minted per open because the token is
 * short-lived; `FeebloProvider` re-identifies the live widget on a new `user`
 * without recreating it (and keeps the last identity when this resolves to
 * `undefined`).
 */
function useWidgetIdentity(openRequests: number): UserIdentity | undefined {
  const [user, setUser] = useState<UserIdentity | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    fetchRpc((rpc) => rpc.GetFeedbackWidgetIdentity())
      .then((identity) => {
        if (cancelled) {
          return;
        }
        setUser({
          email: identity.user.email,
          id: identity.user.id,
          name: identity.user.name,
          token: identity.token,
        });
      })
      .catch(() => {
        // Anonymous feedback is still feedback; see this hook's doc comment.
      });

    return () => {
      cancelled = true;
    };
  }, [openRequests]);

  return user;
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
