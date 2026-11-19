import { useAtomValue } from "@effect/atom-react";
import type { THelpCenterArticleSearchHit } from "@feeblo/domain/help-center-article/schema";
import { Badge } from "@feeblo/ui/badge";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { Skeleton } from "@feeblo/ui/skeleton";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useMemo, useState } from "react";

import { helpCenterSearchAtom, type HelpCenterSearchAtomArgs } from "../atoms";

/** Shorter than this is "typing", not a search. Same floor the portal uses. */
const MIN_SEARCH_LENGTH = 2;

/**
 * The dashboard's article search.
 *
 * It reads the dashboard operation rather than the public one because an editor
 * searching for a page they half-wrote should find it, and because counting an
 * editor's query as a reader's search would turn the portal's "top searches"
 * into an inventory of the team's drafts.
 *
 * The results sit above the section list instead of replacing it: an editor who
 * clears the box is back where they were, and the list behind the results is
 * the context they were reading when they started typing.
 */
export function HelpCenterSearch({
  organizationId,
}: {
  organizationId: string;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  return (
    <div className="space-y-3">
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>
            <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
          </InputGroupText>
        </InputGroupAddon>
        <DebouncedInputGroupInput
          aria-label="Search articles"
          onChange={setQuery}
          placeholder="Search articles, including drafts"
          type="search"
          value={query}
          wait={250}
        />
      </InputGroup>

      {trimmed.length >= MIN_SEARCH_LENGTH ? (
        <SearchResults organizationId={organizationId} query={trimmed} />
      ) : null}
    </div>
  );
}

function SearchResults({
  organizationId,
  query,
}: {
  organizationId: string;
  query: string;
}) {
  const args = useMemo<HelpCenterSearchAtomArgs>(
    () => ({ organizationId, query }),
    [organizationId, query]
  );

  const result = useAtomValue(helpCenterSearchAtom(args));
  const hits = Result.getOrElse(result, () => []);

  if (Result.isInitial(result)) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No article matches “{query}”.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {hits.map((hit) => (
        <SearchResultRow
          hit={hit}
          key={hit.id}
          organizationId={organizationId}
        />
      ))}
    </ul>
  );
}

function SearchResultRow({
  hit,
  organizationId,
}: {
  hit: THelpCenterArticleSearchHit;
  organizationId: string;
}) {
  return (
    <li>
      <Link
        className="hover:bg-muted/50 flex items-start justify-between gap-3 px-3 py-2.5 transition-colors"
        params={{ articleId: hit.id, organizationId }}
        to="/$organizationId/help-center/$articleId"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{hit.title}</span>
            {hit.status === "draft" ? (
              <Badge variant="outline">Draft</Badge>
            ) : null}
            {hit.status === "archived" ? (
              <Badge variant="outline">Archived</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {hit.topicName}
          </p>
        </div>
      </Link>
    </li>
  );
}
