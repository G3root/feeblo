import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { THelpCenterArticlePublic } from "@feeblo/domain/help-center-article/schema";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { MarkdownContent } from "@feeblo/ui/markdown-content";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Textarea } from "@feeblo/ui/textarea";
import { cn } from "@feeblo/ui/utils";
import { markdownHeadings, type MarkdownHeading } from "@feeblo/utils/markdown";
import { isRpcErrorTag } from "@feeblo/web-shared/rpc-error";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addHelpCenterArticleViewAtom,
  helpCenterArticlePublicAtom,
  helpCenterArticlesPublicAtom,
  type HelpCenterArticlePublicAtomArgs,
  helpCenterTopicsPublicAtom,
} from "./atoms";
import {
  buildHelpCenterSections,
  findHelpCenterArticleBySlug,
  findHelpCenterSiblings,
  formatHelpDate,
  type HelpCenterNavArticle,
  type HelpCenterNavSection,
  readingMinutes,
} from "./content";
import {
  HelpCenterArticleActions,
  HelpCenterArticleActionsDisclosure,
} from "./help-center-article-actions";
import { HelpCenterBreadcrumbs, HelpCenterNav } from "./help-center-nav";
import { HelpCenterRailSearch } from "./help-center-rail-search";
import {
  HelpCenterOutlineDisclosure,
  HelpCenterToc,
  scrollToHeading,
} from "./help-center-toc";
import { useHelpCenterVote } from "./use-help-center-vote";

const VISITOR_KEY = "feeblo_help_visitor_id";

const VIEWED_PREFIX = "feeblo_help_viewed:";

/**
 * Reused for every empty read, so a page that has not received its lists yet
 * renders from the same array identity on every pass instead of rebuilding a
 * new `[]` per render and re-deriving the tree.
 */
const EMPTY: ReadonlyArray<never> = [];

/**
 * The portal's article page.
 *
 * The shape mirrors the board's other browse surfaces: a rail of navigation, the
 * page, and a rail of orientation. Everything the article carries is rendered
 * from the public projections only — the body comes from the stored Markdown so
 * "copy as Markdown" copies the source rather than scraping the DOM, a view
 * beacon fires once per article per tab session, and the verdict widget is
 * driven by its own machine (`vote-machine.ts`) rather than a pile of booleans.
 */
export function HelpCenterArticlePage({
  articleSlug,
}: {
  articleSlug: string;
}) {
  const site = useSite();
  const organizationId = site.organizationId;

  // Memoized because `Atom.family` keys on identity: a fresh literal per render
  // would be a fresh atom — and a fetch — per render.
  const articleArgs = useMemo<HelpCenterArticlePublicAtomArgs>(
    () => ({ organizationId, slug: articleSlug }),
    [organizationId, articleSlug]
  );

  const articleAtom = helpCenterArticlePublicAtom(articleArgs);

  const articleResult = useAtomValue(articleAtom);

  const refreshArticle = useAtomRefresh(articleAtom);

  const topicsResult = useAtomValue(helpCenterTopicsPublicAtom(organizationId));

  const articlesResult = useAtomValue(
    helpCenterArticlesPublicAtom(organizationId)
  );

  // The nav tree is a second and third read, not part of the article: a reader
  // who lands here from a search result needs the map of what else exists, and
  // the article payload deliberately carries no list. Both reads are shared
  // with the index page, so arriving here after the index costs nothing.
  const topics = Result.getOrElse(topicsResult, () => EMPTY);
  const articles = Result.getOrElse(articlesResult, () => EMPTY);

  const sections = useMemo(
    () => buildHelpCenterSections({ articles, topics }),
    [articles, topics]
  );

  const article = Result.getOrElse(articleResult, () => undefined);

  /**
   * The article being read, as early as possible.
   *
   * The detail once it arrives; before that, the list's own row for the same
   * slug. The page renders its rails from this rather than from the detail, so
   * a navigation does not unmount the navigation while the body loads — which
   * would drop the reader's expanded sections, since that state lives in
   * `HelpCenterNav`.
   */
  const activeArticle =
    article ?? findHelpCenterArticleBySlug(articles, articleSlug);

  const { section, previous, next } = findHelpCenterSiblings({
    articleId: activeArticle?.id ?? "",
    sections,
  });

  const headings = useMemo(
    () => (article === undefined ? [] : markdownHeadings(article.content)),
    [article]
  );

  const visitorId = useVisitorId();

  useViewBeacon({ articleId: activeArticle?.id, organizationId });

  useLandingHash(article?.id);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:px-8 xl:grid-cols-[15rem_minmax(0,1fr)_13rem] print:grid-cols-1">
      <aside className="hidden md:block print:hidden">
        <div className="sticky top-6 flex max-h-[calc(100dvh-9rem)] flex-col gap-6 overflow-y-auto pb-6">
          <HelpCenterRailSearch organizationId={organizationId} />
          <HelpCenterNav
            activeArticleId={activeArticle?.id}
            activeSectionKey={section?.key}
            sections={sections}
          />
        </div>
      </aside>

      <article className="min-w-0">
        {Result.builder(articleResult)
          .onInitial(() => <ArticleSkeleton />)
          // A decoded RPC failure reaches the atom as the tagged error object
          // itself, while the promise client wraps its cause in `RpcError`; a
          // missing article has to answer "not found" from either shape.
          .onFailure((error) =>
            isRpcErrorTag(error, "NotFoundError") ||
            Predicate.isTagged(error, "NotFoundError") ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyTitle>Article not found</EmptyTitle>
                  <EmptyDescription>
                    It may have been removed, or the link is out of date.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyTitle>Article unavailable</EmptyTitle>
                  <EmptyDescription>
                    There was a problem loading this article.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={refreshArticle}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry
                  </Button>
                </EmptyContent>
              </Empty>
            )
          )
          .onSuccess((loaded) => (
            <ArticleBody
              article={loaded}
              headings={headings}
              next={next}
              organizationId={organizationId}
              previous={previous}
              section={section}
              visitorId={visitorId}
            />
          ))
          .exhaustive()}
      </article>

      <aside className="hidden xl:block print:hidden">
        <div className="sticky top-6 flex flex-col gap-8">
          {headings.length === 0 ? null : <HelpCenterToc headings={headings} />}
          {article === undefined ? null : (
            <HelpCenterArticleActions
              article={article}
              className="border-border/70 border-t pt-4"
            />
          )}
          <StillStuck />
        </div>
      </aside>
    </div>
  );
}

/** The page's placeholder, sized like the page it replaces so nothing jumps. */
function ArticleSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * One article's column: header, body, verdict and neighbouring pages.
 *
 * The body is the only part that needs the loaded article, so it is the only
 * part that waits — the rails above render from the list's row and stay put.
 */
function ArticleBody({
  article,
  headings,
  section,
  previous,
  next,
  organizationId,
  visitorId,
}: {
  article: THelpCenterArticlePublic;
  headings: ReadonlyArray<MarkdownHeading>;
  section: HelpCenterNavSection | undefined;
  previous: HelpCenterNavArticle | undefined;
  next: HelpCenterNavArticle | undefined;
  organizationId: string;
  visitorId: string | undefined;
}) {
  return (
    <>
      <ArticleHeader article={article} section={section} />

      {/* The outline rail appears at `xl`; below that the same headings fold
          into a disclosure, so no screen is left without a way to jump. The
          actions ride in the same disclosure, the way Blume puts them under
          its table of contents; an article with no outline gets its own. */}
      <div className="mt-5 xl:hidden print:hidden">
        <HelpCenterOutlineDisclosure
          footer={<HelpCenterArticleActions article={article} />}
          headings={headings}
        />
        {headings.length < 2 ? (
          <HelpCenterArticleActionsDisclosure
            article={article}
            className="mt-3"
          />
        ) : null}
      </div>

      <div className="border-border/70 mt-5 border-t pt-6">
        <MarkdownContent content={article.content} headingAnchors />
      </div>

      {/*
       * Rendered once the reader can be identified: the tally's key includes the
       * visitor id, and an atom read before it resolves would be a request for a
       * tally it cannot attribute.
       *
       * Keyed by the article: the verdict machine adopts one tally per article,
       * and navigating from `/articles/a` to `/articles/b` keeps this route
       * mounted. Without the key the widget would show A's verdict on B.
       */}
      {visitorId === undefined ? null : (
        <VerdictSection
          key={article.id}
          articleId={article.id}
          organizationId={organizationId}
          visitorId={visitorId}
        />
      )}

      {previous === undefined && next === undefined ? null : (
        <nav
          aria-label="More in this section"
          className="mt-10 grid gap-x-10 gap-y-4 sm:grid-cols-2 print:hidden"
        >
          {previous === undefined ? null : (
            <SiblingLink article={previous} direction="previous" />
          )}
          {next === undefined ? null : (
            <SiblingLink article={next} direction="next" />
          )}
        </nav>
      )}

      <div className="mt-10 xl:hidden print:hidden">
        <StillStuck />
      </div>
    </>
  );
}

/**
 * Lands on the section a `#hash` link named.
 *
 * The body is fetched after the first paint, so the browser's own anchor scroll
 * runs while the heading does not exist yet and nothing happens. This retries
 * once the body is in the document — once per article, so a reader who has
 * scrolled away is never pulled back by a later render.
 */
/**
 * The fragment as a heading id, or `undefined` when it cannot be read.
 *
 * A hash is user-editable and arrives from links written elsewhere, so it can be
 * percent-encoded text that does not decode. That is a malformed URL, not a
 * broken page: skipping the scroll is the whole consequence.
 */
function readHashTarget(): string | undefined {
  const fragment = window.location.hash.slice(1);

  try {
    return decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
}

function useLandingHash(articleId: string | undefined) {
  const landedFor = useRef<string | null>(null);

  useEffect(() => {
    if (articleId === undefined || landedFor.current === articleId) {
      return;
    }

    landedFor.current = articleId;

    const id = readHashTarget();

    if (id === "" || id === undefined) {
      return;
    }

    // The URL already names the section, so only the scroll is ours to do.
    scrollToHeading(id, { updateHash: false });
  }, [articleId]);
}

/**
 * The top of the page: where the reader is, what this is, who wrote it and when.
 *
 * Its own component because it is the one part of the page that reads only the
 * article, while everything under it reads the article's place in the tree — and
 * because the ordering inside it (breadcrumb, section, title, meta, cover) is
 * the part a reader scans before deciding to keep reading.
 *
 * No summary. The article's excerpt is derived from the opening of the body
 * (`help-center-article/write.ts`), so rendering it here would print the first
 * paragraph twice in a row. It is a list row's summary and a search result's
 * description, which is what the index and the metadata use it for.
 */
function ArticleHeader({
  article,
  section,
}: {
  article: THelpCenterArticlePublic;
  section: HelpCenterNavSection | undefined;
}) {
  return (
    <>
      <HelpCenterBreadcrumbs title={article.title} />

      <header className="mt-4">
        {section === undefined ? null : (
          <p className="text-muted-foreground text-xs">{section.name}</p>
        )}
        <h1 className="text-foreground mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {article.title}
        </h1>
        <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {article.authorName === null ? null : (
            <span className="text-foreground font-medium">
              {article.authorName}
            </span>
          )}
          <span>Updated {formatHelpDate(article.updatedAt)}</span>
          <span>{readingMinutes(article.content)} min read</span>
          <span className="tabular-nums">
            {article.viewCount.toLocaleString()}{" "}
            {article.viewCount === 1 ? "view" : "views"}
          </span>
        </div>
        {article.isArchived ? (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            This article describes behaviour that is no longer current.
          </p>
        ) : null}
      </header>

      {article.coverImage === null ? null : (
        <img
          alt=""
          className="mt-6 aspect-[16/7] w-full rounded-xl border object-cover"
          height={525}
          src={article.coverImage}
          width={1200}
        />
      )}
    </>
  );
}

/**
 * The next or previous page in the same section.
 *
 * Both arrows are drawn on both sides and the grid places them, rather than two
 * components that would drift: the only difference between the two links is
 * which way they point and which edge they align to.
 */
function SiblingLink({
  article,
  direction,
}: {
  article: HelpCenterNavArticle;
  direction: "previous" | "next";
}) {
  const isNext = direction === "next";

  return (
    <Link
      className={cn(
        "group hover:bg-muted/50 flex min-w-0 flex-col gap-1 rounded-lg border p-3 transition-colors",
        isNext ? "sm:col-start-2 sm:items-end sm:text-end" : "sm:col-start-1"
      )}
      params={{ articleSlug: article.slug }}
      to="/s/help/articles/$articleSlug"
    >
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {isNext ? null : (
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5"
            icon={ArrowLeft02Icon}
          />
        )}
        {isNext ? "Next" : "Previous"}
        {isNext ? (
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5"
            icon={ArrowRight02Icon}
          />
        ) : null}
      </span>
      <span className="group-hover:text-primary truncate text-sm font-medium">
        {article.title}
      </span>
    </Link>
  );
}

/**
 * The closing card: where to go when the documentation did not answer.
 *
 * It points at the board rather than at a contact form, because the answer a
 * customer service page owes is the one the rest of the product already gives —
 * a request the team answers in public.
 */
function StillStuck() {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm font-medium">Still stuck?</p>
      <p className="text-muted-foreground mt-1 text-[13px] leading-5">
        Post the question on the board. The team answers there, and everyone who
        needs the same answer can follow it.
      </p>
      <Button
        className="mt-3 w-full"
        render={<Link to="/s" />}
        size="sm"
        variant="outline"
      >
        Ask on the board
        <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} />
      </Button>
    </div>
  );
}

function VerdictSection({
  articleId,
  organizationId,
  visitorId,
}: {
  articleId: string;
  organizationId: string;
  visitorId: string;
}) {
  const vote = useHelpCenterVote({ articleId, organizationId, visitorId });
  const total = vote.counts.helpful + vote.counts.notHelpful;

  return (
    <section className="border-border/70 mt-10 border-t pt-6 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">Was this helpful?</p>
        {vote.failed ? (
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-sm">
              Feedback unavailable.
            </p>
            <Button
              onClick={vote.retry}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <HelpfulVoteButton
              active={vote.verdict === true}
              disabled={vote.isPending || !vote.ready}
              onClick={vote.markHelpful}
            />
            <NotHelpfulVoteButton
              active={vote.verdict === false}
              disabled={vote.isPending || !vote.ready}
              onClick={vote.markUnhelpful}
            />
          </div>
        )}
      </div>

      {vote.reasonOpen ? (
        <div className="mt-3 space-y-2">
          <Textarea
            aria-label="What was missing?"
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

/**
 * The two answers, as two components.
 *
 * One `FeedbackButton` with a `helpful` boolean meant every caller had to know
 * which branch of the body a `true` selected, and the icon, the label and the
 * pressed state were all derived from that one flag. The variants name the
 * answer; the shell below owns the words neither of them changes.
 */
function HelpfulVoteButton(props: VoteButtonProps) {
  return (
    <VoteButton {...props}>
      <HugeiconsIcon icon={ThumbsUpIcon} />
      Yes
    </VoteButton>
  );
}

function NotHelpfulVoteButton(props: VoteButtonProps) {
  return (
    <VoteButton {...props}>
      <HugeiconsIcon icon={ThumbsDownIcon} />
      No
    </VoteButton>
  );
}

type VoteButtonProps = {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
};

function VoteButton({
  active,
  children,
  disabled,
  onClick,
}: VoteButtonProps & { children: React.ReactNode }) {
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
      {children}
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
  const recordView = useAtomSet(addHelpCenterArticleViewAtom, {
    mode: "promise",
  });

  const beacon = useCallback(
    (id: string) =>
      recordView({
        payload: {
          organizationId,
          articleId: id,
          id: crypto.randomUUID(),
        },
      }).catch(() => {
        // A read count is not worth an error surface; the server answers
        // `accepted: false` for anything it will not count.
      }),
    [organizationId, recordView]
  );

  useEffect(() => {
    if (articleId === undefined) {
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
