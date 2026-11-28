import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  HELP_CENTER_SEARCH_MAX_QUERY_LENGTH,
  type THelpCenterArticleSearchResult,
} from "@feeblo/domain/help-center-article/schema";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { TablerIcon } from "@feeblo/ui/icon-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { Skeleton } from "@feeblo/ui/skeleton";
import { helpCenterTopicIconName } from "@feeblo/web-shared/icons/defaults";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo, useState } from "react";

import { m } from "@/paraglide/messages.js";

import {
  helpCenterArticlesPublicAtom,
  helpCenterSearchPublicAtom,
  helpCenterTopicsPublicAtom,
} from "./atoms";
import { buildHelpCenterSections, type HelpCenterNavSection } from "./content";

/**
 * How short a query has to be before it is not a search.
 *
 * One character matches most of a help center, so asking the server for it
 * spends a round trip and a rate-limit token to return everything. The number
 * is shared with the widget's deflection for the same reason it exists: both
 * are the difference between "they are typing" and "they are looking for
 * something".
 */
const MIN_SEARCH_LENGTH = 2;

/**
 * The empty read, as one array.
 *
 * `Atom.family` reads return the last value they had, so a pending or failed
 * read falls back to a shared identity rather than a fresh `[]` per render —
 * which would be a new `useMemo` dependency, and a rebuilt tree, on every pass.
 */
const EMPTY: ReadonlyArray<never> = [];

/**
 * The portal's help center index.
 *
 * Read through the public RPCs rather than the dashboard's collections, and
 * deliberately so: the portal sees published articles and nothing else, and a
 * projection that shared the dashboard's list would have to filter drafts out
 * on the client — one forgotten filter away from leaking unreleased
 * documentation.
 *
 * The search lives on this page rather than behind its own route because the
 * index is already the place a reader arrives at; a `/s/help/search?q=` URL
 * would be a second page whose only content is a shorter version of this one.
 * Results replace the topic list rather than filtering it: a topic whose
 * articles all rank low is not useful context beside the ranked answer.
 */
export function HelpCenterPage() {
  const site = useSite();
  const organizationId = site.organizationId;

  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();

  const topicsResult = useAtomValue(helpCenterTopicsPublicAtom(organizationId));

  const articlesResult = useAtomValue(
    helpCenterArticlesPublicAtom(organizationId)
  );

  const refreshTopics = useAtomRefresh(
    helpCenterTopicsPublicAtom(organizationId)
  );

  const refreshArticles = useAtomRefresh(
    helpCenterArticlesPublicAtom(organizationId)
  );

  const listsFailed =
    Result.isFailure(topicsResult) || Result.isFailure(articlesResult);

  const topics = Result.getOrElse(topicsResult, () => EMPTY);
  const articles = Result.getOrElse(articlesResult, () => EMPTY);

  // Memoized because the search box re-renders this page on every keystroke: the
  // tree is derived from two reads, not from the query, and rebuilding its maps
  // per character would be work the reader never asked for.
  const sections = useMemo(
    () => buildHelpCenterSections({ articles, topics }),
    [articles, topics]
  );

  // The server rejects a hidden help center before this page loads. Keep the
  // same answer here so a stale provider or a client transition cannot render
  // an empty help center that the workspace does not serve.
  if (site.helpCenterVisibility !== "PUBLIC") {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{m.white_civil_bee_mix()}</EmptyTitle>
          <EmptyDescription>{m.happy_lower_rabbit_tickle()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (Result.isInitial(topicsResult) || Result.isInitial(articlesResult)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {m.maroon_close_panda_approve()}
        </h1>
        <p className="text-muted-foreground text-sm">
          {m.stout_smart_cod_build({ site: site.name })}
        </p>
      </header>

      <div className="mt-6">
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>
              <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
            </InputGroupText>
          </InputGroupAddon>
          <DebouncedInputGroupInput
            aria-label={m.that_fuzzy_maggot_roar()}
            maxLength={HELP_CENTER_SEARCH_MAX_QUERY_LENGTH}
            onChange={setQuery}
            placeholder={m.tangy_smug_wolf_engage()}
            type="search"
            value={query}
            wait={250}
          />
        </InputGroup>
      </div>

      {trimmedQuery.length >= MIN_SEARCH_LENGTH ? (
        <HelpCenterSearchResults
          organizationId={organizationId}
          query={trimmedQuery}
        />
      ) : (
        <HelpCenterSectionsList
          failed={listsFailed}
          onRetry={() => {
            refreshTopics();
            refreshArticles();
          }}
          sections={sections}
        />
      )}
    </div>
  );
}

/**
 * The list under the search box: the sections, the empty state, or the failure
 * state.
 *
 * A component because the page already forks on whether there is a query, and
 * a second fork in the same JSX expression would nest one ternary inside
 * another inside another. The search stays available when the list reads fail:
 * it is a different operation, and a reader who cannot browse can still ask.
 */
function HelpCenterSectionsList({
  failed,
  onRetry,
  sections,
}: {
  failed: boolean;
  onRetry: () => void;
  sections: ReadonlyArray<HelpCenterNavSection>;
}) {
  if (failed) {
    return <HelpCenterUnavailable onRetry={onRetry} />;
  }

  if (sections.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{m.legal_glad_cod_vent()}</EmptyTitle>
          <EmptyDescription>{m.hour_dry_dove_swim()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {sections.map((section) => (
        <HelpCenterSection key={section.key} section={section} />
      ))}
    </div>
  );
}

/**
 * The index when the two list reads could not be loaded.
 *
 * Both are refreshed together because the page renders their intersection: a
 * topic list without its articles is not a smaller help center, and retrying
 * only one would leave the other half missing.
 */
function HelpCenterUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>{m.alert_drab_kudu_zip()}</EmptyTitle>
        <EmptyDescription>{m.misty_vexed_cod_learn()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          {m.even_seemly_bear()}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * One section of the index: its name, its description and its articles.
 *
 * Fed by the same tree the article page's rail renders (`content.ts`), so the
 * index and the sidebar cannot list different articles under one heading.
 */
function HelpCenterSection({ section }: { section: HelpCenterNavSection }) {
  return (
    <section className="rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TablerIcon
            className="text-muted-foreground size-4"
            name={helpCenterTopicIconName(section.icon)}
          />
          {section.name}
        </h2>
        {section.description === null ? null : (
          <p className="text-muted-foreground text-xs">{section.description}</p>
        )}
      </header>
      <ul className="divide-y">
        {section.articles.map((article) => (
          <ArticleRow article={article} key={article.id} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One article in a topic's list, or one search hit.
 *
 * The fields come from the public search projection rather than being restated:
 * a list row is that same projection plus counters, so the two surfaces cannot
 * drift into rendering different fields from the same article.
 */
type ArticleRowItem = Pick<
  THelpCenterArticleSearchResult,
  "excerpt" | "id" | "isArchived" | "slug" | "title"
>;

/** One article in a topic's list. */
function ArticleRow({ article }: { article: ArticleRowItem }) {
  return (
    <li>
      <Link
        className="hover:bg-muted/50 flex items-start gap-3 px-4 py-3 transition-colors"
        params={{ articleSlug: article.slug }}
        to="/s/help/articles/$articleSlug"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{article.title}</span>
            {article.isArchived ? (
              <Badge variant="outline">{m.good_red_flamingo_aid()}</Badge>
            ) : null}
          </div>
          {article.excerpt.length === 0 ? null : (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
              {article.excerpt}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

/**
 * The ranked results for one query.
 *
 * A component of its own so the atom read only exists while there is a query to
 * read: hooks cannot be conditional, and mounting this is the condition. The
 * args are memoized because `helpCenterSearchPublicAtom` is a family keyed on
 * identity.
 */
function HelpCenterSearchResults({
  organizationId,
  query,
}: {
  organizationId: string;
  query: string;
}) {
  // No `useMemo`: the family keys on the workspace and the query by value, so a
  // fresh object resolves to the same atom.
  const atom = helpCenterSearchPublicAtom({ organizationId, query });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  if (Result.isInitial(result)) {
    return (
      <div className="mt-6 space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // A failed request is not "nothing matches": telling a reader the answer does
  // not exist because the network dropped is worse than saying so.
  if (Result.isFailure(result)) {
    return (
      <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <p className="text-muted-foreground text-sm">
          {m.spare_bland_tuna_slurp()}
        </p>
        <Button onClick={refresh} size="sm" type="button" variant="outline">
          {m.even_seemly_bear()}
        </Button>
      </div>
    );
  }

  const hits = Result.getOrElse(result, () => []);

  if (hits.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{m.great_big_chicken_mop()}</EmptyTitle>
          <EmptyDescription>
            {m.small_left_nils_sew({ query })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-muted-foreground text-xs">
        {hits.length === 1
          ? m.happy_only_martin_wish({ count: hits.length })
          : m.last_aware_gibbon_blink({ count: hits.length })}
      </p>
      <ul className="mt-2 divide-y rounded-lg border">
        {hits.map((hit) => (
          <ArticleRow article={hit} key={hit.id} />
        ))}
      </ul>
    </div>
  );
}
