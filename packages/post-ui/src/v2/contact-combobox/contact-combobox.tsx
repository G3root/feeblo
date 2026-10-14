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
import {
  EmailSchema,
  isDeliverableAuthorEmail,
} from "@feeblo/web-shared/user-validation";
import {
  Cancel01Icon,
  Search01Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { m } from "../../paraglide/messages.js";

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
export const searchContacts: ContactSearchFn = ({
  organizationId,
  postId,
  query,
}) =>
  fetchRpc((rpc) =>
    rpc.ContactSearch({
      organizationId,
      query,
      ...(postId === undefined ? undefined : { postId }),
    })
  );

/**
 * The plan-room probe that decides whether the create-new-customer row is
 * offered. Separate from `ContactSearch` so the picker does not pay for two
 * counts on every keystroke; it runs once, when the entry point appears.
 */
export type ContactCreateEligibilityFn = (input: {
  organizationId: string;
}) => Promise<{ canCreate: boolean }>;

/** Live eligibility transport; injectable so stories/tests stay hermetic. */
export const fetchContactCreateEligibility: ContactCreateEligibilityFn = ({
  organizationId,
}) => fetchRpc((rpc) => rpc.ContactCreateEligibility({ organizationId }));

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
    ...(selection.contactId ? { contactId: selection.contactId } : undefined),
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
  /** Disables the search input and selection; the selected summary's
  dismiss control stays available so a picked subject can be cleared. */
  disabled?: boolean;
  /**
   * Whether an `alreadyVoted` contact is unselectable. Voter pickers keep
   * the default (`true`) so the same person cannot be added twice;
   * author pickers pass `false` — voting history must not block
   * attribution, and the badge is hidden there as noise.
   */
  disableAlreadyVoted?: boolean;
  /** Replace the plan-room probe (stories/tests). */
  createEligibility?: ContactCreateEligibilityFn;
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
  createEligibility = fetchContactCreateEligibility,
  disabled = false,
  disableAlreadyVoted = true,
  label = m.best_mealy_lynx(),
  organizationId,
  onSelect,
  placeholder = m.happy_same_oryx(),
  postId,
  search = searchContacts,
  value,
}: ContactComboboxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly TContactSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Whether the latest ContactSearch round-trip failed. While set, the
  // "no match — create new customer" entry is suppressed: an empty result
  // list after an error is not evidence that no customer exists.
  const [searchFailed, setSearchFailed] = useState(false);
  // Bumped by the retry button to re-run the search effect for the same query.
  const [retryToken, setRetryToken] = useState(0);
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
      setSearchFailed(false);
      setIsSearching(false);
      return;
    }

    // Preserve results while the next debounced query settles so the popup
    // does not flash between keystrokes.
    const controller = new AbortController();
    let isCurrent = true;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      searchRef
        .current({
          organizationId,
          query: trimmed,
          ...(postId === undefined ? undefined : { postId }),
        })
        .then((nextResults) => {
          if (isCurrent && !controller.signal.aborted) {
            setResults(nextResults);
            setSearchFailed(false);
          }
        })
        .catch(() => {
          if (isCurrent && !controller.signal.aborted) {
            setResults([]);
            setSearchFailed(true);
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
  }, [organizationId, postId, query, retryToken]);

  const trimmedQuery = query.trim();
  // The create-new path feeds the raw query to find-or-create as an EMAIL;
  // non-email queries (names) only ever surface real search results. The
  // deliverability check mirrors the server's `AuthorEmail` filter so the
  // entry point is only offered for addresses the RPC will accept.
  const queryLooksLikeEmail =
    trimmedQuery.length >= MIN_QUERY_LENGTH &&
    EmailSchema.safeParse(trimmedQuery).success &&
    isDeliverableAuthorEmail(trimmedQuery);
  // The create-new entry is always offered for email-like
  // queries, not just on empty results — otherwise a substring hit hides the
  // only path to attribute to someone new. Suppressed only for an exact
  // email hit (submit would resolve to them anyway) and on transport errors
  // (empty results prove nothing after a failure). Selecting it votes for
  // the email via the resolver's find-or-create, same as before.
  const exactEmailHit = results.some(
    (contact) =>
      contact.email !== null &&
      contact.email.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const offersCreate = queryLooksLikeEmail && !searchFailed && !exactEmailHit;
  const createOption: ContactOption[] = offersCreate
    ? [{ kind: "create", email: trimmedQuery }]
    : [];

  // Plan room is asked when the create entry appears. The answer is stored
  // with the workspace it describes, so a switch to another workspace reads
  // as "not asked yet" and probes again even when the previous answer was
  // `false`. The picker's open handler drops the answer each time it opens,
  // so a plan that changed while the picker was closed is measured against
  // the current cap. `null` leaves the row selectable: the write path
  // re-checks the cap inside its transaction, so a stale hint can never
  // over-grant.
  const [createEligibilityResult, setCreateEligibilityResult] = useState<{
    canCreate: boolean;
    organizationId: string;
  } | null>(null);
  const canCreateContact =
    createEligibilityResult?.organizationId === organizationId
      ? createEligibilityResult.canCreate
      : null;
  const createEligibilityRef = useRef(createEligibility);
  useEffect(() => {
    createEligibilityRef.current = createEligibility;
  });
  useEffect(() => {
    if (!offersCreate || canCreateContact !== null) {
      return;
    }
    let isCurrent = true;
    const probedOrganizationId = organizationId;
    createEligibilityRef.current({ organizationId: probedOrganizationId }).then(
      ({ canCreate }) => {
        if (isCurrent) {
          setCreateEligibilityResult({
            canCreate,
            organizationId: probedOrganizationId,
          });
        }
      },
      () => {
        // Leave the row selectable: a failed probe proves nothing, and the
        // write path answers the cap with copy of its own.
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [canCreateContact, offersCreate, organizationId]);

  const options: ContactOption[] = [
    ...results.map((contact): ContactOption => ({ kind: "contact", contact })),
    ...createOption,
  ];

  const handleSelect = (option: ContactOption | null) => {
    if (disabled || !option) {
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

  // Opening the picker invalidates the cached plan-room answer so the effect
  // below probes again when the create entry appears.
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setCreateEligibilityResult(null);
    }
  };

  // A picked subject replaces the input with a readable summary row so the
  // attribution stays visible until submit; clearing returns to search mode.
  // The empty-object default (no subject picked) must read as "nothing
  // selected" so the picker opens normally.
  if (value !== null && hasOnBehalfAuthorValue(value)) {
    const displayName = value.name ?? value.email ?? m.aqua_awake_meerkat();

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
            <Badge variant="outline">{m.sad_soft_tadpole()}</Badge>
          ) : null}
          <Button
            aria-label={m.short_teary_seahorse()}
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
            {m.hour_smart_wombat()}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Combobox
      autoHighlight
      disabled={disabled}
      filter={null}
      inputValue={query}
      items={options}
      onInputValueChange={(nextQuery, eventDetails) => {
        // Filter-style combobox: only keystrokes drive the query. Base UI
        // also syncs the pressed item into the input on select
        // ('item-press') and on close ('none'), which would flash the raw
        // option object in the input. Selection clears the query
        // explicitly in handleSelect instead.
        if (eventDetails.reason !== "input-change") {
          return;
        }
        setQuery(nextQuery);
      }}
      onOpenChange={handleOpenChange}
      onValueChange={handleSelect}
      open={open}
    >
      <ComboboxInput
        aria-label={label}
        disabled={disabled}
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
            {m.sunny_elegant_thrush()}
          </p>
        ) : null}
        {!isSearching &&
        trimmedQuery.length > 0 &&
        trimmedQuery.length < MIN_QUERY_LENGTH ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            {m.loud_giant_goat({ count: MIN_QUERY_LENGTH })}
          </p>
        ) : null}
        {!isSearching &&
        searchFailed &&
        trimmedQuery.length >= MIN_QUERY_LENGTH ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-muted-foreground text-xs">
              {m.smug_crisp_alpaca()}
            </p>
            <Button
              onClick={() => setRetryToken((token) => token + 1)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {m.even_seemly_bear()}
            </Button>
          </div>
        ) : null}
        {!isSearching &&
        !searchFailed &&
        trimmedQuery.length >= MIN_QUERY_LENGTH ? (
          <ComboboxList>
            {(option) =>
              option.kind === "create" ? (
                <ComboboxItem
                  disabled={canCreateContact === false}
                  key={`create:${option.email}`}
                  value={option}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <HugeiconsIcon
                      className="text-muted-foreground mt-0.5"
                      icon={UserAdd01Icon}
                      strokeWidth={2}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        {results.length === 0
                          ? m.misty_red_vole({ email: option.email })
                          : m.agent_gross_anteater({ email: option.email })}
                      </span>
                      {/* A brand-new address has no account here, so the
                          action grants attribution before (or instead of)
                          notification. Say so before the admin submits. */}
                      <span className="text-muted-foreground block text-xs">
                        {canCreateContact === false
                          ? m.brave_tidy_quokka()
                          : m.hour_smart_wombat()}
                      </span>
                    </span>
                  </span>
                </ComboboxItem>
              ) : (
                <ComboboxItem
                  disabled={disableAlreadyVoted && option.contact.alreadyVoted}
                  key={
                    option.contact.contactId ??
                    option.contact.userId ??
                    option.contact.email
                  }
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
                          {m.curly_watery_polecat()}
                        </p>
                      ) : null}
                    </div>
                    {option.contact.companyName ? (
                      <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                        {option.contact.companyName}
                      </span>
                    ) : null}
                    {option.contact.isMember ? (
                      <Badge variant="outline">{m.sad_soft_tadpole()}</Badge>
                    ) : null}
                    {option.contact.alreadyVoted && disableAlreadyVoted ? (
                      <Badge variant="outline">
                        {m.even_fancy_crocodile()}
                      </Badge>
                    ) : null}
                  </div>
                </ComboboxItem>
              )
            }
          </ComboboxList>
        ) : null}
        {!isSearching && trimmedQuery.length === 0 ? (
          <ComboboxEmpty>{m.warm_steep_vole()}</ComboboxEmpty>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}
