import { useAtomValue } from "@effect/atom-react";
import {
  HELP_CENTER_SEARCH_MAX_QUERY_LENGTH,
  type THelpCenterArticleSearchHit,
} from "@feeblo/domain/help-center-article/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@feeblo/ui/command";
import { Kbd, KbdGroup } from "@feeblo/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CornerDownLeftIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import * as Result from "effect/reactivity/AsyncResult";
import { useEffect, useState } from "react";

import { helpCenterSearchAtom } from "../atoms";

/** A search hit plus the `label`/`value` pair the command list reads. */
type SearchItem = THelpCenterArticleSearchHit & {
  readonly label: string;
  readonly value: string;
};

/** Shorter than this is "typing", not a search. Same floor the portal uses. */
const MIN_SEARCH_LENGTH = 2;

/**
 * Long enough that a typed word is one request, short enough that the result
 * feels attached to the keystroke that caused it.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The dashboard's article search, behind an icon button.
 *
 * A command dialog rather than a field on the page: the help center index is a
 * list of sections, and a search box above it invited readers to type an
 * article title into a page whose job is navigation. The dialog is the same
 * pattern the merge picker uses, so the keyboard behaviour is already known.
 *
 * It reads the dashboard operation rather than the public one because an editor
 * searching for a page they half-wrote should find it, and because counting an
 * editor's query as a reader's search would turn the portal's "top searches"
 * into an inventory of the team's drafts.
 */
export function HelpCenterSearch({
  organizationId,
}: {
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              aria-label="Search articles"
              onClick={() => setOpen(true)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <HugeiconsIcon icon={Search01Icon} />
            </Button>
          )}
        />
        <TooltipPopup>Search articles</TooltipPopup>
      </Tooltip>
      {open ? (
        <HelpCenterSearchDialog
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
            }
          }}
          organizationId={organizationId}
        />
      ) : null}
    </>
  );
}

/**
 * The dialog's body, mounted only while open.
 *
 * That mount is the reset: closing throws the query and the results away, so
 * the next open starts on an empty box instead of a search from last time. It
 * is also why `open` is passed as a constant — this component only exists while
 * the dialog is open, and `onOpenChange` is the close request.
 */
function HelpCenterSearchDialog({
  onOpenChange,
  organizationId,
}: {
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}) {
  const [input, setInput] = useState("");
  const query = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);
  const navigate = useNavigate();

  // No `useMemo`: the atom family keys on the workspace and the query by value.
  const result = useAtomValue(helpCenterSearchAtom({ organizationId, query }));
  const hits = Result.getOrElse(result, () => []);

  // The command's item shape. Base UI reads `label` for the input value when an
  // item is highlighted and `value` for its identity, so the row carries both
  // rather than teaching the component how to stringify an article.
  const items: ReadonlyArray<SearchItem> = hits.map((hit) => ({
    ...hit,
    label: hit.title,
    value: hit.id,
  }));

  const openArticle = (articleId: string) => {
    onOpenChange(false);
    void navigate({
      params: { articleId, organizationId },
      to: "/$organizationId/help-center/article/$articleId",
    });
  };

  return (
    <CommandDialog onOpenChange={onOpenChange} open>
      <CommandDialogPopup>
        <Command
          filteredItems={items}
          items={items}
          onValueChange={setInput}
          value={input}
        >
          <CommandInput
            maxLength={HELP_CENTER_SEARCH_MAX_QUERY_LENGTH}
            placeholder="Search articles..."
          />
          <CommandPanel>
            <CommandEmpty>{emptyMessage(result, query)}</CommandEmpty>
            <CommandList>
              {(item: SearchItem) => (
                <CommandItem
                  key={item.id}
                  onClick={() => openArticle(item.id)}
                  value={item}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.status === "draft" ? (
                    <Badge
                      className="ml-2 shrink-0"
                      size="sm"
                      variant="outline"
                    >
                      Draft
                    </Badge>
                  ) : null}
                  <CommandShortcut className="ml-2 shrink-0 tracking-normal">
                    {item.topicName}
                  </CommandShortcut>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd>
                    <HugeiconsIcon icon={ArrowUp01Icon} />
                  </Kbd>
                  <Kbd>
                    <HugeiconsIcon icon={ArrowDown01Icon} />
                  </Kbd>
                </KbdGroup>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>
                  <HugeiconsIcon icon={CornerDownLeftIcon} />
                </Kbd>
                <span>Open</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

/**
 * What stands in for the result list, in the order the states can be true.
 *
 * A failed request is not an empty result: "no article matches" for a request
 * that never completed would send an editor off to write a page that already
 * exists.
 */
function emptyMessage(
  result: Result.AsyncResult<
    ReadonlyArray<THelpCenterArticleSearchHit>,
    unknown
  >,
  query: string
): string {
  if (query.length < MIN_SEARCH_LENGTH) {
    return `Type at least ${MIN_SEARCH_LENGTH} characters to search.`;
  }

  if (Result.isFailure(result)) {
    return "Search is unavailable right now.";
  }

  if (Result.isInitial(result)) {
    return "Searching...";
  }

  return `No article matches “${query}”.`;
}

/**
 * A value that trails its input by `wait`, so a typed word is one query.
 *
 * The UI package's `DebouncedInputGroupInput` does this for form fields, but the
 * command input is an autocomplete control that owns its own value, so the
 * debounce has to sit beside it rather than inside it.
 */
function useDebouncedValue<T>(value: T, wait: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), wait);

    return () => clearTimeout(timer);
  }, [value, wait]);

  return debounced;
}
