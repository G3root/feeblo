import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { CopyButton } from "@feeblo/ui/copy-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Textarea } from "@feeblo/ui/textarea";
import { cn } from "@feeblo/ui/utils";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import {
  ArrowLeft02Icon,
  Copy01Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useHelpCenterVote } from "./use-help-center-vote";

const VISITOR_KEY = "feeblo_help_visitor_id";

const VIEWED_PREFIX = "feeblo_help_viewed:";

/**
 * One formatter for every date on the page.
 *
 * `toLocaleDateString()` with an options object builds a fresh
 * `Intl.DateTimeFormat` on every call, and an article page renders a date at
 * least once. Hoisted so the work happens once per module load rather than once
 * per render.
 */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The portal's article page.
 *
 * Three things happen here that the design of the tables exists to support:
 * the body renders from the stored Markdown (so "copy as Markdown" copies the
 * source rather than scraping the DOM), a view beacon fires once per article
 * per tab session, and the verdict widget is driven by its own machine
 * (`vote-machine.ts`) rather than by a pile of booleans.
 */
export function HelpCenterArticlePage({
  articleSlug,
}: {
  articleSlug: string;
}) {
  const site = useSite();
  const organizationId = site.organizationId;
  const enabled = isFeatureEnabled("HELP_CENTER");

  const articleQuery = useQuery({
    enabled,
    queryKey: ["portal-help-center-article", organizationId, articleSlug],
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticlePublic({ organizationId, slug: articleSlug })
      ),
  });

  const visitorId = useVisitorId();
  const articleId = articleQuery.data?.id;

  useViewBeacon({ articleId, organizationId });

  if (!enabled) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>Not found</EmptyTitle>
          <EmptyDescription>This page is not available.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (articleQuery.isError) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>Article not found</EmptyTitle>
          <EmptyDescription>
            It may have been removed, or the link is out of date.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (articleQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const article = articleQuery.data;

  return (
    <article className="mx-auto w-full max-w-3xl py-8">
      <Button
        render={<Link to="/s/help" />}
        size="sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} />
        Help center
      </Button>

      <header className="mt-4 space-y-2">
        <p className="text-muted-foreground text-xs">
          <Link className="hover:text-foreground" to="/s/help">
            {article.topicName}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {article.title}
        </h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {article.authorName === null ? null : (
            <span>Written by {article.authorName}</span>
          )}
          <span>Updated {DATE_FORMAT.format(article.updatedAt)}</span>
          <span className="tabular-nums">
            {article.viewCount.toLocaleString()} views
          </span>
        </div>
        {article.isArchived ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            This article describes behaviour that is no longer current.
          </p>
        ) : null}
      </header>

      <div className="mt-4 flex justify-end">
        <CopyButton
          onCopy={() => article.content}
          successMessage="Markdown copied"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon icon={Copy01Icon} />
          Copy as Markdown
        </CopyButton>
      </div>

      <div className="mt-2 border-t pt-6">
        <MarkdownContent content={article.content} />
      </div>

      {/*
       * Keyed by the article: the verdict machine adopts one tally per article,
       * and navigating from `/articles/a` to `/articles/b` keeps this route
       * mounted. Without the key the widget would show A's verdict on B.
       */}
      <VerdictSection
        key={article.id}
        articleId={article.id}
        organizationId={organizationId}
        visitorId={visitorId}
      />
    </article>
  );
}

function VerdictSection({
  articleId,
  organizationId,
  visitorId,
}: {
  articleId: string;
  organizationId: string;
  visitorId: string | undefined;
}) {
  const vote = useHelpCenterVote({ articleId, organizationId, visitorId });
  const total = vote.counts.helpful + vote.counts.notHelpful;

  return (
    <section className="mt-10 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">Was this helpful?</p>
        <div className="flex items-center gap-2">
          <FeedbackButton
            active={vote.verdict === true}
            disabled={vote.isPending || !vote.ready}
            helpful
            onClick={vote.markHelpful}
          />
          <FeedbackButton
            active={vote.verdict === false}
            disabled={vote.isPending || !vote.ready}
            helpful={false}
            onClick={vote.markUnhelpful}
          />
        </div>
      </div>

      {vote.reasonOpen ? (
        <div className="mt-3 space-y-2">
          <Textarea
            maxLength={2000}
            onChange={(event) => vote.setReason(event.target.value)}
            placeholder="What was missing? (optional)"
            rows={3}
            value={vote.reason}
          />
          <Button
            disabled={vote.isPending}
            onClick={vote.sendReason}
            size="sm"
            type="button"
            variant="outline"
          >
            Send feedback
          </Button>
        </div>
      ) : null}

      {!vote.ready ? null : (
        <p className="text-muted-foreground mt-3 text-xs tabular-nums">
          {total === 0
            ? "No votes yet."
            : `${vote.counts.helpful} of ${total} readers found this helpful.`}
        </p>
      )}
    </section>
  );
}

function FeedbackButton({
  active,
  disabled,
  helpful,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  helpful: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <HugeiconsIcon icon={helpful ? ThumbsUpIcon : ThumbsDownIcon} />
      {helpful ? "Yes" : "No"}
    </button>
  );
}

/**
 * The browser's stable id for this reader.
 *
 * `localStorage`, not a cookie and not a fingerprint: the value is random, it
 * never leaves this origin except as the vote key, and clearing site data
 * forgets it. It exists because most readers of a help center are not signed
 * in, and without it every anonymous vote would be one per page load.
 *
 * Read in an effect rather than a `useState` initialiser because the portal is
 * server-rendered and `window` does not exist there. Callers gate their
 * requests on the id being present instead of sending one without it.
 */
/**
 * Where the id lives when `localStorage` refuses to be written.
 *
 * Module scope, so it survives a remount within one document even though it
 * does not survive a reload. Losing it costs one duplicate vote; a crash costs
 * the whole page.
 */
let memoryVisitorId: string | null = null;

function useVisitorId(): string | undefined {
  const [visitorId, setVisitorId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Storage access is not guaranteed: Safari's private mode and a browser
    // with site data disabled both throw from `localStorage`, and a throw
    // inside an effect unmounts the page. The identity is a convenience, so a
    // refused write falls back to memory and the reader still gets a working
    // widget.
    const resolved = (() => {
      try {
        const existing = window.localStorage.getItem(VISITOR_KEY);

        if (existing !== null) {
          return existing;
        }

        const generated = crypto.randomUUID();
        window.localStorage.setItem(VISITOR_KEY, generated);

        return generated;
      } catch {
        memoryVisitorId ??= crypto.randomUUID();

        return memoryVisitorId;
      }
    })();

    setVisitorId(resolved);
  }, []);

  return visitorId;
}

/**
 * One view per article per tab session.
 *
 * The dedupe is a client-side convenience, not an identity: the server still
 * deduplicates on the beacon's own id, so a page that fires twice — a remount,
 * a retry — is still one read.
 *
 * Deliberately does not take the visitor id. The beacon carries none, and
 * depending on it would re-run this effect when the id resolves for no reason.
 */
function useViewBeacon({
  articleId,
  organizationId,
}: {
  articleId: string | undefined;
  organizationId: string;
}) {
  const beacon = useCallback(
    (id: string) =>
      fetchRpc((rpc) =>
        rpc.AddHelpCenterArticleView({
          organizationId,
          articleId: id,
          id: crypto.randomUUID(),
        })
      ).catch(() => {
        // A read count is not worth an error surface; the server answers
        // `accepted: false` for anything it will not count.
      }),
    [organizationId]
  );

  useEffect(() => {
    if (!isFeatureEnabled("HELP_CENTER") || articleId === undefined) {
      return;
    }

    const key = `${VIEWED_PREFIX}${articleId}`;

    // `sessionStorage` can refuse for the same reasons `localStorage` can. A
    // refused *read* is treated as "not seen yet" and a refused *write* costs
    // one extra count on a remount — both are better than losing the view.
    try {
      if (window.sessionStorage.getItem(key) !== null) {
        return;
      }

      window.sessionStorage.setItem(key, "1");
    } catch {
      // Fall through: send the beacon and accept the dedupe we cannot keep.
    }

    void beacon(articleId);
  }, [articleId, beacon]);
}
