import type { TContactSearchResult } from "@feeblo/domain/contact/schema";
import type { TPostCreateAuthor } from "@feeblo/domain/post/schema";
import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@feeblo/ui/combobox";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { EmailSchema } from "@feeblo/web-shared/user-validation";
import { Cancel01Icon, Search01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

/** Debounce applied before each ContactSearch round-trip. */
const SEARCH_DEBOUNCE_MS = 200;
/** Minimum query length before the picker hits ContactSearch. */
const MIN_QUERY_LENGTH = 2;

/**
 * Zod mirror of {@link ContactComboboxSelection} for forms that keep the
 * selection in TanStack Form state. `hasAccess` / `isMember` are display-only
 * hints and are stripped by `toOnBehalfAuthor` before anything is sent.
 */
export const OnBehalfAuthorSchema = z.object({
  avatarUrl: z.string().optional(),
  contactId: z.string().optional(),
  email: z.string().optional(),
  hasAccess: z.boolean().optional(),
  isMember: z.boolean().optional(),
  name: z.string().optional(),
  userId: z.string().optional(),
});

export type OnBehalfAuthor = z.infer<typeof OnBehalfAuthorSchema>;

/** The "no subject picked" form value. */
export const emptyOnBehalfAuthor: OnBehalfAuthor = {};

/**
 * Distinguishes a real selection from the empty-object default: only an
 * identifying value (id or email) counts — enrichment fields like name or
 * avatar alone are never attribution, mirroring the resolver's own
 * "at least one identifier" rule.
 */
export function hasOnBehalfAuthorValue(
  author: OnBehalfAuthor | undefined
): author is OnBehalfAuthor {
  return (
    author !== undefined &&
    [author.contactId, author.email, author.userId].some(
      (value) => value !== undefined && value !== ""
    )
  );
}

/**
 * The subject an on-behalf action is attributed to, shaped like
 * `PostCreateAuthor` plus two display-only hints (`isMember` / `hasAccess`)
 * that power the "workspace member" badge and the notification hint. Use
 * `toOnBehalfAuthor` to strip the hints before attaching a selection to an
 * RPC payload.
 */
export type ContactComboboxSelection = OnBehalfAuthor;

export type ContactSearchFn = (input: {
  organizationId: string;
  postId?: string;
  query: string;
}) => Promise<readonly TContactSearchResult[]>;

/** Live ContactSearch transport; injectable so stories/tests stay hermetic. */
export const searchContacts: ContactSearchFn = ({ organizationId, postId, query }) =>
  fetchRpc((rpc) =>
    rpc.ContactSearch({
      organizationId,
      query,
      ...(postId === undefined ? undefined : { postId }),
    })
  );

/**
 * Projects a selection onto the wire shape shared by `PostCreate.author`,
 * `CommentCreate.author` and `UpvoteAddOnBehalf.author`, dropping the
 * display-only hints.
 */
export function toOnBehalfAuthor(
  selection: ContactComboboxSelection
): TPostCreateAuthor {
  // Conditional spreads (never empty-object spreads) keep the wire shape
  // free of explicit undefined values under exactOptionalPropertyTypes.
  return {
    ...(selection.avatarUrl ? { avatarUrl: selection.avatarUrl } : undefined),
    ...(selection.contactId
      ? { contactId: selection.contactId }
      : undefined),
    ...(selection.email ? { email: selection.email } : undefined),
    ...(selection.name ? { name: selection.name } : undefined),
    ...(selection.userId ? { userId: selection.userId } : undefined),
  };
}

/** One-line label for a picked subject ("Name" falling back to email). */
export function describeContactSelection(
  selection: ContactComboboxSelection | null | undefined
): string | null {
  if (!selection) {
    return null;
  }
  return selection.name ?? selection.email ?? null;
}

type ContactOption =
  | { readonly kind: "contact"; readonly contact: TContactSearchResult }
  // Synthetic entry for the "no match" empty state: selecting it attributes
  // the action to a brand-new customer keyed by the raw typed email.
  | { readonly kind: "create"; readonly email: string };

function initialsOf(name: string | null, email: string | null) {
  const source = name ?? email ?? "";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[1]?.[0] ?? "") : ""}`.toUpperCase();
}

function ContactAvatar({
  avatarUrl,
  email,
  name,
}: {
  avatarUrl: string | null;
  email: string | null;
  name: string | null;
}) {
  return (
    <Avatar className="shrink-0" size="sm">
      {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
      <AvatarFallback>{initialsOf(name, email)}</AvatarFallback>
    </Avatar>
  );
}

export interface ContactComboboxProps {
  /** Accessible name for the search input. */
  label?: string;
  organizationId: string;
  /**
   * Post-scoped search: enables the `alreadyVoted` badge so voters cannot be
   * added twice from the picker.
   */
  onSelect: (selection: ContactComboboxSelection | null) => void;
  placeholder?: string;
  postId?: string;
  /** Replace the ContactSearch transport (stories/tests). */
  search?: ContactSearchFn;
  value: ContactComboboxSelection | null;
}

export function ContactCombobox({
  label = "Search customers",
  organizationId,
  onSelect,
  placeholder = "Search by name or email...",
  postId,
  search = searchContacts,
  value,
}: ContactComboboxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly TContactSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [open, setOpen] = useState(false);

  // The transport is read through a latest-ref so consumers may pass an
  // inline function without re-triggering the debounced effect on every
  // render; searches are driven by the query alone.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    // Preserve results while the next debounced query settles so the popup
    // does not flash between keystrokes.
    const controller = new AbortController();
    let isCurrent = true;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      searchRef.current({
        organizationId,
        query: trimmed,
        ...(postId === undefined ? undefined : { postId }),
      })
        .then((nextResults) => {
          if (isCurrent && !controller.signal.aborted) {
            setResults(nextResults);
          }
        })
        .catch(() => {
          if (isCurrent && !controller.signal.aborted) {
            setResults([]);
          }
        })
        .finally(() => {
          if (isCurrent) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [organizationId, postId, query]);

  const trimmedQuery = query.trim();
  // The create-new path feeds the raw query to find-or-create as an EMAIL;
  // non-email queries (names) only ever surface real search results.
  const queryLooksLikeEmail =
    trimmedQuery.length >= MIN_QUERY_LENGTH &&
    EmailSchema.safeParse(trimmedQuery).success;
  const options: ContactOption[] =
    queryLooksLikeEmail && results.length === 0
      ? [{ kind: "create", email: trimmedQuery }]
      : results.map((contact) => ({ kind: "contact", contact }));

  const handleSelect = (option: ContactOption | null) => {
    if (!option) {
      return;
    }

    if (option.kind === "create") {
      onSelect({ email: option.email });
    } else {
      const contact = option.contact;
      const selection: ContactComboboxSelection = {};

      if (contact.avatarUrl) {
        selection.avatarUrl = contact.avatarUrl;
      }
      if (contact.contactId) {
        selection.contactId = contact.contactId;
      }
      if (contact.email) {
        selection.email = contact.email;
      }
      if (contact.name) {
        selection.name = contact.name;
      }
      if (contact.userId) {
        selection.userId = contact.userId;
      }
      selection.hasAccess = contact.hasAccess;
      selection.isMember = contact.isMember;
      onSelect(selection);
    }

    setQuery("");
    setOpen(false);
  };

  // A picked subject replaces the input with a readable summary row so the
  // attribution stays visible until submit; clearing returns to search mode.
  // The empty-object default (no subject picked) must read as "nothing
  // selected" so the picker opens normally.
  if (value !== null && hasOnBehalfAuthorValue(value)) {
    const displayName = value.name ?? value.email ?? "Customer";

    return (
      <div className="flex flex-col gap-1">
        <div className="border-input bg-background flex items-center gap-2 rounded-md border py-1.5 ps-2 pe-1">
          <ContactAvatar
            avatarUrl={value.avatarUrl ?? null}
            email={value.email ?? null}
            name={value.name ?? null}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {value.name && value.email ? (
              <p className="text-muted-foreground truncate text-xs">
                {value.email}
              </p>
            ) : null}
          </div>
          {value.isMember ? (
            <Badge variant="outline">Workspace member</Badge>
          ) : null}
          <Button
            aria-label="Remove selected person"
            onClick={() => onSelect(null)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </Button>
        </div>
        {value.hasAccess === false ? (
          <p className="text-muted-foreground text-xs">
            Won't be notified until they have access to this workspace.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Combobox
      autoHighlight
      filter={null}
      inputValue={query}
      items={options}
      onInputValueChange={(nextQuery) => setQuery(nextQuery)}
      onOpenChange={setOpen}
      onValueChange={handleSelect}
      open={open}
    >
      <ComboboxInput
        aria-label={label}
        onBlur={() => {
          if (trimmedQuery.length === 0) {
            setOpen(false);
          }
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        showClear
        showTrigger={false}
        size="sm"
        startAddon={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
        clearProps={{
          onClick: () => setQuery(""),
        }}
      />
      <ComboboxPopup aria-label={label}>
        {isSearching ? (
          <p
            aria-live="polite"
            className="text-muted-foreground px-3 py-2 text-xs"
          >
            Searching…
          </p>
        ) : null}
        {!isSearching &&
        trimmedQuery.length > 0 &&
        trimmedQuery.length < MIN_QUERY_LENGTH ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            Type at least {MIN_QUERY_LENGTH} characters to search.
          </p>
        ) : null}
        {!isSearching && trimmedQuery.length >= MIN_QUERY_LENGTH ? (
          <ComboboxList>
            {(option) =>
              option.kind === "create" ? (
                <ComboboxItem key={`create:${option.email}`} value={option}>
                  <span className="flex items-center gap-2">
                    <HugeiconsIcon
                      className="text-muted-foreground"
                      icon={UserAdd01Icon}
                      strokeWidth={2}
                    />
                    <span>
                      No match — add{" "}
                      <span className="font-medium">{option.email}</span> as new
                      customer
                    </span>
                  </span>
                </ComboboxItem>
              ) : (
                <ComboboxItem
                  disabled={option.contact.alreadyVoted}
                  key={option.contact.contactId}
                  value={option}
                >
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <ContactAvatar
                      avatarUrl={option.contact.avatarUrl}
                      email={option.contact.email}
                      name={option.contact.name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {option.contact.name ?? option.contact.email}
                      </p>
                      {option.contact.name && option.contact.email ? (
                        <p className="text-muted-foreground truncate text-xs">
                          {option.contact.email}
                        </p>
                      ) : null}
                      {option.contact.hasAccess === false ? (
                        <p className="text-muted-foreground truncate text-xs">
                          Won't be notified until they have access
                        </p>
                      ) : null}
                    </div>
                    {option.contact.companyName ? (
                      <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                        {option.contact.companyName}
                      </span>
                    ) : null}
                    {option.contact.isMember ? (
                      <Badge variant="outline">Workspace member</Badge>
                    ) : null}
                    {option.contact.alreadyVoted ? (
                      <Badge variant="outline">Already voted</Badge>
                    ) : null}
                  </div>
                </ComboboxItem>
              )
            }
          </ComboboxList>
        ) : null}
        {!isSearching && trimmedQuery.length === 0 ? (
          <ComboboxEmpty>Type a name or email to search.</ComboboxEmpty>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}
