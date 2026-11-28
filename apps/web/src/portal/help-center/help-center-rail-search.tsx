import { useAtomValue } from "@effect/atom-react";
import { HELP_CENTER_SEARCH_MAX_QUERY_LENGTH } from "@feeblo/domain/help-center-article/schema";
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
import { useState } from "react";

import { m } from "@/paraglide/messages.js";

import { helpCenterSearchPublicAtom } from "./atoms";

/**
 * How short a query has to be before it is not a search.
 *
 * Shared with the index page's box: one character matches most of a help center,
 * so asking the server for it spends a round trip and a rate-limit token to come
 * back with everything.
 */
const MIN_SEARCH_LENGTH = 2;

/**
 * Search, from wherever the reader is.
 *
 * The rail rather than a route of its own: a reader deep in an article who
 * cannot find what they need should not have to travel back to the index to ask
 * again. Results open under the box instead of replacing the page, so the
 * article they were reading stays where it was.
 */
export function HelpCenterRailSearch({
  organizationId,
}: {
  organizationId: string;
}) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();

  return (
    <div className="flex flex-col gap-2">
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

      {trimmedQuery.length < MIN_SEARCH_LENGTH ? null : (
        <RailSearchResults
          key={trimmedQuery}
          organizationId={organizationId}
          query={trimmedQuery}
        />
      )}
    </div>
  );
}

/**
 * The hits for one query.
 *
 * A component of its own so the atom read only exists while there is a query to
 * read: hooks cannot be conditional, and mounting this is the condition.
 */
function RailSearchResults({
  organizationId,
  query,
}: {
  organizationId: string;
  query: string;
}) {
  const result = useAtomValue(
    helpCenterSearchPublicAtom({ organizationId, query })
  );

  return Result.builder(result)
    .onInitial(() => (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    ))
    .onFailure(() => (
      <p className="text-muted-foreground px-1 text-xs">
        {m.spare_bland_tuna_slurp()}
      </p>
    ))
    .onSuccess((hits) =>
      hits.length === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">
          {m.safe_proud_kestrel_advise({ query })}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Link
                className="hover:bg-muted/60 block rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors"
                params={{ articleSlug: hit.slug }}
                to="/s/help/articles/$articleSlug"
              >
                <span className="block truncate font-medium">{hit.title}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {hit.topicName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )
    )
    .exhaustive();
}
