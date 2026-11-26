import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  For,
  type JSX,
  on,
  Show,
} from "solid-js";

import { fetchHelpCenter } from "../../lib/api";
import { getWidgetConfig, moduleForPath } from "../../lib/config";
import {
  firstAvailableHref,
  resolveView,
  widgetTabs,
} from "../../lib/navigation";
import { Button, buttonVariants } from "../ui/button";
import { Icon } from "../ui/icon";
import { PoweredByBadge } from "../ui/powered-by-badge";

/**
 * The widget's frame: a control header, one scrolling body, and — when the
 * config has more than one surface — a bottom tab bar. The body is the only
 * scroller, so the header and the bar stay put while content moves between
 * them, and every view starts at the top because navigation resets it here
 * rather than leaving the previous view's offset behind.
 */
export function WidgetShell(props: {
  children: JSX.Element;
  onClose: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const config = getWidgetConfig();
  const view = createMemo(() => resolveView(location.pathname));

  /**
   * Whether the workspace actually has documentation.
   *
   * The config says the workspace *asked* for the Help module; whether anything
   * is published is a fact only the server knows. Held as a resource so the tab
   * appears once the answer arrives — and stays hidden for a workspace whose
   * help center is off, rather than offering a surface that will never fill.
   */
  const [helpAvailable] = createResource(
    () => config.modules.includes("help"),
    (wanted) =>
      wanted
        ? fetchHelpCenter()
            .then((helpCenter) => helpCenter.enabled)
            .catch(() => false)
        : Promise.resolve(false)
  );

  const tabs = createMemo(() =>
    widgetTabs(config, { helpAvailable: helpAvailable() === true })
  );

  const activeModule = createMemo(() => moduleForPath(location.pathname));

  /**
   * Move a reader off a surface that turns out not to exist.
   *
   * `false` is "the server says no", which is the only answer that should move
   * anybody: while the resource is pending, the Help page renders its own
   * skeleton rather than being bounced out from under the click that opened it.
   */
  createEffect(() => {
    if (helpAvailable() !== false || activeModule() !== "help") {
      return;
    }

    const href = firstAvailableHref(config, { helpAvailable: false });

    if (href !== null) {
      navigate(href, { replace: true });
    }
  });

  const activeTabIndex = createMemo(() =>
    Math.max(
      0,
      tabs().findIndex((tab) => tab.module === activeModule())
    )
  );

  let scroller: HTMLElement | undefined;

  createEffect(
    on(
      () => location.pathname,
      () => scroller?.scrollTo({ top: 0 })
    )
  );

  return (
    <div
      class="bg-popover text-popover-foreground flex h-full min-h-full w-full flex-col overflow-hidden"
      data-feeblo-widget-container
      data-slot="widget-shell"
    >
      <header
        class="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-3"
        data-slot="widget-header"
      >
        <div class="flex min-w-0 items-center gap-1">
          <Show when={view().backHref}>
            {(href) => (
              <A
                aria-label="Go back"
                class={buttonVariants({ size: "icon-sm", variant: "ghost" })}
                href={href()}
              >
                <Icon name="ArrowLeft01Icon" />
              </A>
            )}
          </Show>
        </div>
        <Button
          aria-label="Close"
          onClick={props.onClose}
          size="icon-sm"
          variant="ghost"
        >
          <Icon name="Cancel01Icon" />
        </Button>
      </header>

      <main
        class="hide-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto"
        data-slot="widget-scroll"
        ref={(el) => {
          scroller = el;
        }}
      >
        {props.children}
      </main>

      <Show when={tabs().length > 1}>
        <nav
          aria-label="Widget sections"
          class="bg-popover relative z-10 shrink-0 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          data-slot="widget-tab-bar"
        >
          <ul
            class="bg-muted relative flex gap-1 rounded-xl p-1"
            style={{
              "--tab-count": tabs().length,
              "--active-tab": activeTabIndex(),
            }}
          >
            {/*
             * The pill is a sibling of the tabs and slides between them, so a
             * section switch reads as one control rather than two background
             * swaps. The tabs are equal width, so the pill's width and offset
             * are pure arithmetic on --tab-count.
             */}
            <span
              aria-hidden="true"
              class="bg-background pointer-events-none absolute inset-y-1 left-1 z-0 rounded-lg shadow-sm/5 transition-transform duration-200 ease-in-out motion-reduce:transition-none"
              data-slot="widget-tab-indicator"
              style={{
                width:
                  "calc((100% - 0.5rem - (var(--tab-count) - 1) * 0.25rem) / var(--tab-count))",
                transform:
                  "translateX(calc(var(--active-tab) * (100% + 0.25rem)))",
              }}
            />
            <For each={tabs()}>
              {(tab) => (
                <li class="relative z-10 min-w-0 flex-1">
                  <A
                    aria-current={
                      activeModule() === tab.module ? "page" : undefined
                    }
                    class="text-muted-foreground/72 focus-visible:ring-ring focus-visible:ring-offset-background aria-[current=page]:text-foreground flex w-full items-center justify-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 sm:py-1.5"
                    href={tab.href}
                    preload
                  >
                    <Icon class="size-4" name={tab.icon} />
                    {tab.label}
                  </A>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </Show>

      <PoweredByBadge />
    </div>
  );
}
