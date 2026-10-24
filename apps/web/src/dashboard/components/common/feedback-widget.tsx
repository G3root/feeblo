import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@feeblo/ui/sidebar";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { CustomerSupportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useReducer,
  type ReactNode,
} from "react";

/**
 * The dashboard's own feedback widget: Feeblo's SDK embedded in our app so a
 * signed-in user can tell us what is wrong without leaving it.
 *
 * `FEEDBACK_WIDGET_ORGANIZATION_ID` names the workspace that receives what the
 * button submits — Feeblo's own on feeblo.com. It is an operator setting and
 * not the route's organization: mounting the *viewer's* workspace here would
 * file their feedback in their own inbox. Unset means off, which is the right
 * state for any deployment without such a workspace.
 *
 * Nothing here imports `@feeblo/sdk-react`: the embed is a separate chunk,
 * fetched the first time the button is pressed. A widget that boots on every
 * dashboard page costs an iframe document plus ~65 kB of gzip widget code that
 * most sessions never open, so the mount waits for the click.
 */
const FeedbackWidgetEmbed = lazy(() => import("./feedback-widget-embed"));

/** How the sidebar opens the widget. Stable for the provider's lifetime. */
const FeedbackWidgetContext = createContext<null | (() => void)>(null);

/**
 * Wraps the surface that can open the widget. Without a configured
 * organization it renders its children with no context, so the trigger below
 * renders nothing and the SDK is never even fetched.
 *
 * One widget per page: the embed mounts exactly one `FeebloProvider`, and
 * nothing else in the app calls `Feeblo.init` (there is no CDN script tag
 * either).
 */
export function FeedbackWidgetProvider({ children }: { children: ReactNode }) {
  const organizationId = getRuntimePublicEnv().feedbackWidgetOrganizationId;
  // A count rather than a boolean: the first request mounts the embed, and
  // every later one has to reopen a widget that was mounted and then closed.
  const [openRequests, requestOpen] = useReducer(
    (count: number) => count + 1,
    0
  );

  if (!organizationId) {
    return children;
  }

  return (
    <FeedbackWidgetContext value={requestOpen}>
      {children}
      {openRequests > 0 ? (
        <Suspense fallback={null}>
          <FeedbackWidgetEmbed
            openRequests={openRequests}
            organizationId={organizationId}
          />
        </Suspense>
      ) : null}
    </FeedbackWidgetContext>
  );
}

/**
 * The sidebar trigger, and the only way into the widget: the embed passes no
 * `placement`, so the SDK draws no launcher of its own. Opening before the
 * iframe reports ready is safe — the SDK re-sends `SHOW` once it loads.
 *
 * Labelled "Support" because that is the door a customer looks for when
 * something is wrong; the panel it opens is Feeblo's own feedback widget, so
 * the report lands on our board attributed to whoever is signed in.
 */
export function SupportButton() {
  const open = useContext(FeedbackWidgetContext);
  const { isMobile, setOpenMobile } = useSidebar();

  if (!open) {
    return null;
  }

  // The panel floats above the page, so on a phone it should not sit behind
  // the modal sidebar sheet the button was pressed in.
  const handleClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    open();
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={handleClick}>
        <HugeiconsIcon icon={CustomerSupportIcon} />
        <span>Support</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
