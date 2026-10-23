import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { m } from "../paraglide/messages.js";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border-border/70 bg-muted/20 border border-dashed">
        <EmptyHeader>
          <EmptyTitle>{m.salty_empty_shrike()}</EmptyTitle>
          <EmptyDescription>{m.true_upper_antelope()}</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants({ variant: "outline" })} to="/s">
          {m.orange_male_bumblebee()}
        </Link>
      </Empty>
    </div>
  );
}

export interface BoardNotFoundPageProps {
  /** The host the visitor requested, including its port when one is used. */
  readonly host: string;
  /** The requested subdomain, or null when the URL is not a board host. */
  readonly subdomain: string | null;
  /** The board that exists at the host, when only the page is missing. */
  readonly siteName: string | null;
  /** The dashboard origin, for the action that sends a visitor somewhere real. */
  readonly dashboardUrl: string;
}

/**
 * The document-level 404 for a board host.
 *
 * The board layout's `notFoundComponent` renders this instead of the board
 * shell: an unknown subdomain has no site to put in a `SiteProvider`, and a
 * missing post or changelog entry aborts the layout's `beforeLoad` before it
 * can resolve one either. The two cases therefore read differently — an
 * unknown board points at the dashboard, a missing page points back at the
 * board that does exist — while sharing one layout.
 */
export function BoardNotFoundPage({
  dashboardUrl,
  host,
  siteName,
  subdomain,
}: BoardNotFoundPageProps) {
  if (siteName !== null) {
    return (
      <BoardNotFoundLayout
        action={
          <Link className={buttonVariants({ variant: "outline" })} to="/s">
            {m.orange_male_bumblebee()}
          </Link>
        }
        description={m.not_found_description_with_site({ name: siteName })}
        title={m.salty_empty_shrike()}
      />
    );
  }

  return (
    <BoardNotFoundLayout
      action={
        <a
          className={buttonVariants({ variant: "outline" })}
          href={dashboardUrl}
        >
          {m.not_found_go_to_dashboard()}
        </a>
      }
      description={
        subdomain === null
          ? m.not_found_description_generic()
          : m.not_found_description_with_host({ host })
      }
      title={m.salty_empty_shrike()}
    />
  );
}

function BoardNotFoundLayout({
  action,
  description,
  title,
}: {
  readonly action: ReactNode;
  readonly description: ReactNode;
  readonly title: ReactNode;
}) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border-border/70 bg-muted/20 w-full max-w-md border border-dashed">
        <EmptyHeader>
          <span className="text-muted-foreground font-mono text-xs tracking-[0.25em]">
            404
          </span>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{action}</EmptyContent>
      </Empty>
    </main>
  );
}
