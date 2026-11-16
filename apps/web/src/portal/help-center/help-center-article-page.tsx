import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const VISITOR_KEY = "feeblo_help_visitor_id";
const VIEWED_PREFIX = "feeblo_help_viewed:";

/**
 * The portal's article page.
 *
 * Three things happen here that the design of the tables exists to support:
 *
 * - The body renders from the stored Markdown, so "copy as Markdown" copies the
 *   source rather than scraping the DOM.
 * - A view beacon fires once per article per tab session. The id is generated
 *   per visit and the server deduplicates on it, so a reload is not a second
 *   read.
 * - A vote is keyed to the reader: an account when signed in, otherwise a
 *   random id this browser keeps. Either way it is one row per reader, which is
 *   what makes the two counts sum to one verdict each.
 */
export function HelpCenterArticlePage({
  articleSlug,
}: {
  articleSlug: string;
}) {
  const site = useSite();
  const organizationId = site.organizationId;
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  const articleQuery = useQuery({
    queryKey: ["portal-help-center-article", organizationId, articleSlug],
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticlePublic({ organizationId, slug: articleSlug })
      ),
  });

  const visitorId = useVisitorId();
  const articleId = articleQuery.data?.id;

  useViewBeacon({ articleId, organizationId, visitorId });

  const feedbackQuery = useQuery({
    queryKey: [
      "portal-help-center-feedback",
      organizationId,
      articleId,
      visitorId,
    ],
    enabled: articleId !== undefined,
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticleFeedbackPublic({
          organizationId,
          articleId: articleId ?? "",
          visitorId,
        })
      ),
  });

  const vote = useMutation({
    mutationFn: (helpful: boolean) =>
      fetchRpc((rpc) =>
        rpc.SetHelpCenterArticleFeedback({
          organizationId,
          articleId: articleId ?? "",
          helpful,
          reason: helpful ? null : reason.trim() || null,
          visitorId,
        })
      ),
    onSuccess: (tally) => {
      queryClient.setQueryData(
        ["portal-help-center-feedback", organizationId, articleId, visitorId],
        tally
      );
      if (tally.mine === true) {
        setShowReason(false);
      }
    },
  });

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
  const tally = feedbackQuery.data;
  const mine = tally?.mine ?? null;

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
          <span>Updated {formatDate(article.updatedAt)}</span>
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

      <section className="mt-10 border-t pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Was this helpful?</p>
          <div className="flex items-center gap-2">
            <FeedbackButton
              active={mine === true}
              disabled={vote.isPending || articleId === undefined}
              helpful
              onClick={() => vote.mutate(true)}
            />
            <FeedbackButton
              active={mine === false}
              disabled={vote.isPending || articleId === undefined}
              helpful={false}
              onClick={() => {
                setShowReason(true);
                vote.mutate(false);
              }}
            />
          </div>
        </div>

        {showReason && mine === false ? (
          <div className="mt-3 space-y-2">
            <Textarea
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What was missing? (optional)"
              rows={3}
              value={reason}
            />
            <Button
              disabled={vote.isPending}
              onClick={() => vote.mutate(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Send feedback
            </Button>
          </div>
        ) : null}

        {tally === undefined ? null : (
          <p className="text-muted-foreground mt-3 text-xs tabular-nums">
            {tally.helpfulCount + tally.notHelpfulCount === 0
              ? "No votes yet."
              : `${tally.helpfulCount} of ${
                  tally.helpfulCount + tally.notHelpfulCount
                } readers found this helpful.`}
          </p>
        )}
      </section>
    </article>
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
 */
function useVisitorId(): string | undefined {
  const [visitorId, setVisitorId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing !== null) {
      setVisitorId(existing);
      return;
    }
    const generated = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, generated);
    setVisitorId(generated);
  }, []);

  return visitorId;
}

/**
 * One view per article per tab session.
 *
 * The dedupe is a client-side convenience, not an identity: the server still
 * deduplicates on the beacon's own id, so a page that fires twice — a
 * remount, a retry — is still one read.
 */
function useViewBeacon({
  articleId,
  organizationId,
  visitorId,
}: {
  articleId: string | undefined;
  organizationId: string;
  visitorId: string | undefined;
}) {
  useEffect(() => {
    if (articleId === undefined) {
      return;
    }

    const key = `${VIEWED_PREFIX}${articleId}`;
    if (window.sessionStorage.getItem(key) !== null) {
      return;
    }
    window.sessionStorage.setItem(key, "1");

    void fetchRpc((rpc) =>
      rpc.AddHelpCenterArticleView({
        organizationId,
        articleId,
        id: crypto.randomUUID(),
      })
    ).catch(() => {
      // A read count is not worth an error surface; the server answers
      // `accepted: false` for anything it will not count.
    });
  }, [articleId, organizationId, visitorId]);
}

const formatDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
