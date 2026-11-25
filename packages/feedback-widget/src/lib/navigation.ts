import type { IconName } from "../icons/types";
import type { WidgetConfig, WidgetModule } from "./config";

/**
 * The widget's navigation model, kept free of Solid and the router so the
 * rules (which view is a push, where its back control points, which tabs a
 * config shows) can be asserted directly rather than through a rendered tree.
 */
export type WidgetViewKind = "root" | "push";

export interface WidgetView {
  /** Where the header's back control points; null on a root view. */
  backHref: string | null;
  kind: WidgetViewKind;
}

const COMPOSE_PATH = /^\/board\/[^/]+\/?$/;

const UPDATE_DETAIL_PATH = /^\/updates\/[^/]+\/?$/;

const HELP_ARTICLE_PATH = /^\/help\/[^/]+\/?$/;

/**
 * The compose form and the update detail are pushed on top of their surface's
 * list, so they animate from the side and carry a back control. Everything
 * else is a surface root.
 */
export function resolveView(pathname: string): WidgetView {
  if (COMPOSE_PATH.test(pathname)) {
    return { backHref: "/", kind: "push" };
  }

  if (UPDATE_DETAIL_PATH.test(pathname)) {
    return { backHref: "/updates", kind: "push" };
  }

  if (HELP_ARTICLE_PATH.test(pathname)) {
    return { backHref: "/help", kind: "push" };
  }

  return { backHref: null, kind: "root" };
}

export interface WidgetTab {
  href: string;
  icon: IconName;
  label: string;
  module: WidgetModule;
}

const TAB_PRESENTATION = {
  feedback: { href: "/", icon: "Idea01Icon", label: "Feedback" },
  updates: { href: "/updates", icon: "NewspaperIcon", label: "Updates" },
  help: { href: "/help", icon: "Book01Icon", label: "Help" },
} as const satisfies Record<WidgetModule, Omit<WidgetTab, "module">>;

/**
 * The bottom tab bar is navigation between surfaces, so it exists only when
 * there is more than one to move between. A hub limited to a single module is
 * one surface wearing a hub's config, and a bar with one item is chrome for
 * nothing.
 */
export function widgetTabs(
  config: WidgetConfig,
  options: { readonly helpAvailable?: boolean } = {}
): readonly WidgetTab[] {
  // Help is the one module a workspace can configure and then not have: the
  // documentation is published in the dashboard, so the surface exists only
  // once something is live there. A hidden tab is the honest answer — and the
  // bar's "more than one surface" rule has to count what is actually visible.
  const modules = config.modules.filter(
    (module) => module !== "help" || options.helpAvailable === true
  );

  if (config.mode !== "hub" || modules.length < 2) {
    return [];
  }

  return modules.map((module) => ({
    module,
    ...TAB_PRESENTATION[module],
  }));
}
