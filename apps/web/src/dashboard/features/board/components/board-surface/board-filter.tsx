import {
  BOARD_VIEW_FILTER_IDS_MAX,
  BOARD_VIEW_SEARCH_MAX_LENGTH,
  emptyBoardQuery,
  hasActiveBoardFilters,
  normalizeBoardFilters,
  type TBoardFilters,
  type TBoardGroupBy,
  type TBoardGrouping,
} from "@feeblo/domain-contracts/board-query";
import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import { Group, GroupText } from "@feeblo/ui/group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@feeblo/ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuPortal,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { cn } from "@feeblo/ui/utils";
import { type BoardPostStatus } from "@feeblo/web-shared/board/constants";
import {
  Cancel01Icon,
  DashedLineCircleIcon,
  FilterMailIcon,
  GroupItemsIcon,
  Search01Icon,
  Tag01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";

import { useCurrentMemberId } from "~/hooks/use-current-member-id";
import { useOrgMembers } from "~/hooks/use-org-members";
import { useOrgPostStatuses } from "~/hooks/use-org-post-statuses";
import { useOrgTags } from "~/hooks/use-org-tags";

import { namesOrCount } from "../../lib/filter-summary";
import { BOARD_GROUPING_OPTIONS, boardGroupingLabel } from "../../lib/grouping";
import {
  type BoardStatusOperator,
  type BoardTagOperator,
  useBoardGrouping,
  useBoardStore,
} from "../../state/board-store-context";

type FilterTag = {
  id: string;
  name: string;
};

/**
 * One assignable member.
 *
 * `id` is the `member` row id — the value `post.assigneeMemberId` holds — not
 * the user id, because a user can be a member of several workspaces and only
 * the member row belongs to this board's workspace.
 */
type FilterMember = {
  id: string;
  image: string | null;
  isCurrentUser: boolean;
  name: string;
};

type FilterStatus = {
  id: string;
  label: string;
  type: BoardPostStatus;
};

type BoardFilterActions = {
  clearAllFilters: () => void;
  clearAssigneeFilter: () => void;
  clearStatusFilter: () => void;
  clearTagFilter: () => void;
  setSearch: (value: string) => void;
  setStatusOperator: (operator: BoardStatusOperator) => void;
  setTagOperator: (operator: BoardTagOperator) => void;
  toggleAssignee: (memberId: string) => void;
  toggleStatus: (status: BoardPostStatus) => void;
  toggleTag: (tagId: string) => void;
};

type BoardFilterContextValue = BoardFilterActions & {
  /** The signed-in member, for the filter's "Assigned to me" shortcut. */
  currentMemberId: string | undefined;
  filters: TBoardFilters;
  grouping: TBoardGrouping;
  members: FilterMember[];
  organizationId: string;
  postStatuses: FilterStatus[];
  setGroupBy: (field: TBoardGroupBy) => void;
  tags: FilterTag[];
};

const BoardFilterContext = createContext<BoardFilterContextValue | null>(null);

const STATUS_OPERATOR_OPTIONS: Array<{
  label: string;
  value: BoardStatusOperator;
}> = [
  { label: "is any of", value: "isAnyOf" },
  { label: "is not", value: "isNot" },
];

const TAG_OPERATOR_OPTIONS: Array<{
  label: string;
  value: BoardTagOperator;
}> = [
  { label: "include all of", value: "includeAllOf" },
  { label: "include any of", value: "includeAnyOf" },
  { label: "exclude if any of", value: "excludeIfAnyOf" },
  { label: "exclude if all of", value: "excludeIfAllOf" },
];

function useBoardFilterState() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.activeView.filters);
}

function useBoardFilterContext() {
  const context = useContext(BoardFilterContext);

  if (!context) {
    throw new Error(
      "BoardFilter components must be used within BoardFilter.Root or BoardFilter.Editor"
    );
  }

  return context;
}

/**
 * The statuses, labels and members a filter menu may offer.
 *
 * Shared by the store-connected toolbar filter and the controlled editor, so
 * the two cannot disagree about which names resolve or in what order the
 * assignee list is shown.
 */
function useBoardFilterReferenceData(organizationId: string) {
  const { data: postStatusRows } = useOrgPostStatuses(organizationId);
  const { data: tags } = useOrgTags(organizationId);
  const { data: organizationMembers } = useOrgMembers(organizationId);
  const currentMemberId = useCurrentMemberId(organizationId);

  // The status filter stores a *type*, so the menu offers one row per type even
  // when the workspace defines several statuses of it. Two rows for one type
  // would look independently selectable and would toggle together; the lane
  // list still reads every row, because a lane is a real status.
  const postStatuses = useMemo<FilterStatus[]>(() => {
    const byType = new Map<BoardPostStatus, FilterStatus>();

    for (const postStatus of postStatusRows ?? []) {
      if (!byType.has(postStatus.type)) {
        byType.set(postStatus.type, postStatus);
      }
    }

    return [...byType.values()];
  }, [postStatusRows]);

  const members = useMemo<FilterMember[]>(() => {
    const rows = (organizationMembers ?? []).map((member) => ({
      id: member.id,
      image: member.user.image,
      isCurrentUser: member.id === currentMemberId,
      // A member row always has a user, and the session's user list is what
      // names them; the email is the fallback so a member who has not set a
      // name still appears in the assignee list as something recognisable.
      name: member.user.name || member.user.email,
    }));

    // "Me" first: the common filter is "what am I working on", and it should
    // not need a scan down an alphabetized list to find.
    return rows.sort((left, right) => {
      if (left.isCurrentUser !== right.isCurrentUser) {
        return left.isCurrentUser ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [organizationMembers, currentMemberId]);

  return useMemo(
    () => ({
      currentMemberId,
      members,
      postStatuses,
      tags,
    }),
    [currentMemberId, members, postStatuses, tags]
  );
}

/**
 * The filter mutations as a function of the value and its setter.
 *
 * This is the whole reason the same chips can be wired to the board store and
 * to a form's draft: every event produces a new `TBoardFilters` and hands it to
 * `onChange`, and the two callers differ only in where that value is written.
 */
function useBoardFilterActions(
  filters: TBoardFilters,
  onChange: (filters: TBoardFilters) => void
): BoardFilterActions {
  return useMemo<BoardFilterActions>(() => {
    // Every event is normalized: ids are sorted and de-duplicated, and an
    // emptied dimension becomes `null`. The store and the sheet's draft then
    // hold the same canonical value, which is what makes "the board is showing
    // this view" a structural comparison rather than a per-filter one.
    const update = (patch: Partial<TBoardFilters>) =>
      onChange(normalizeBoardFilters({ ...filters, ...patch }));
    const toggle = <T,>(list: readonly T[], value: T) =>
      list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value];
    // A checked id can still be removed at the cap: the limit bounds what a
    // saved view stores, not what the member is allowed to deselect.
    const atFilterLimit = (ids: readonly string[], id: string) =>
      ids.length >= BOARD_VIEW_FILTER_IDS_MAX && !ids.includes(id);

    return {
      clearAllFilters: () =>
        onChange(normalizeBoardFilters(emptyBoardQuery.filters)),
      clearAssigneeFilter: () => update({ assigneeMemberIds: null }),
      clearStatusFilter: () => update({ status: null }),
      clearTagFilter: () => update({ tag: null }),
      setSearch: (search) => update({ search }),
      setStatusOperator: (operator) =>
        update({
          status:
            filters.status === null ? null : { ...filters.status, operator },
        }),
      setTagOperator: (operator) =>
        update({
          tag: filters.tag === null ? null : { ...filters.tag, operator },
        }),
      toggleAssignee: (memberId) => {
        const current = filters.assigneeMemberIds ?? [];

        if (atFilterLimit(current, memberId)) {
          return;
        }

        const next = toggle(current, memberId);

        update({ assigneeMemberIds: next.length === 0 ? null : next });
      },
      toggleStatus: (type) => {
        const current = filters.status;
        const next = toggle(current?.types ?? [], type);

        update({
          status:
            next.length === 0
              ? null
              : { operator: current?.operator ?? "isAnyOf", types: next },
        });
      },
      toggleTag: (tagId) => {
        const current = filters.tag;
        const currentIds = current?.tagIds ?? [];

        if (atFilterLimit(currentIds, tagId)) {
          return;
        }

        const next = toggle(currentIds, tagId);

        update({
          tag:
            next.length === 0
              ? null
              : {
                  operator: current?.operator ?? "includeAllOf",
                  tagIds: next,
                },
        });
      },
    };
  }, [filters, onChange]);
}

/**
 * Provides the filter context for a caller-owned value.
 *
 * `BoardFilter.Root` supplies the board store's live filters; the edit-view
 * sheet supplies a draft query that only becomes the stored row on save. Every
 * chip, menu and summary below reads this context, so there is one filter UI
 * and no second copy of the operators or the summary wording.
 */
function BoardFilterProvider({
  children,
  filters,
  grouping,
  onChange,
  onGroupByChange,
  organizationId,
}: {
  children: ReactNode;
  filters: TBoardFilters;
  grouping: TBoardGrouping;
  onChange: (filters: TBoardFilters) => void;
  onGroupByChange: (field: TBoardGroupBy) => void;
  organizationId: string;
}) {
  const reference = useBoardFilterReferenceData(organizationId);
  const actions = useBoardFilterActions(filters, onChange);

  const value = useMemo<BoardFilterContextValue>(
    () => ({
      ...reference,
      ...actions,
      filters,
      grouping,
      organizationId,
      setGroupBy: onGroupByChange,
    }),
    [actions, filters, grouping, onGroupByChange, organizationId, reference]
  );

  return (
    <BoardFilterContext.Provider value={value}>
      {children}
    </BoardFilterContext.Provider>
  );
}

/** The toolbar's filter, wired to the board store. */
function BoardFilterRoot({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const store = useBoardStore();
  const filters = useBoardFilterState();
  const grouping = useBoardGrouping();
  const onChange = useCallback(
    (next: TBoardFilters) => {
      store.send({ type: "setFilters", filters: next });
    },
    [store]
  );
  const onGroupByChange = useCallback(
    (field: TBoardGroupBy) => {
      store.send({ type: "setGroupBy", field });
    },
    [store]
  );

  return (
    <BoardFilterProvider
      filters={filters}
      grouping={grouping}
      onChange={onChange}
      onGroupByChange={onGroupByChange}
      organizationId={organizationId}
    >
      {children}
    </BoardFilterProvider>
  );
}

/**
 * The filter editor used by the edit-view sheet.
 *
 * Composed from the same pieces the toolbar uses, but against a caller-owned
 * value: changing a menu here edits the sheet's draft, not the board behind it.
 */
function BoardFilterEditor({
  filters,
  grouping,
  onChange,
  onGroupByChange,
  organizationId,
}: {
  filters: TBoardFilters;
  grouping: TBoardGrouping;
  onChange: (filters: TBoardFilters) => void;
  onGroupByChange: (field: TBoardGroupBy) => void;
  organizationId: string;
}) {
  return (
    <BoardFilterProvider
      filters={filters}
      grouping={grouping}
      onChange={onChange}
      onGroupByChange={onGroupByChange}
      organizationId={organizationId}
    >
      <BoardFilterEditorPanel />
    </BoardFilterProvider>
  );
}

function BoardFilterEditorPanel() {
  const { clearAllFilters, filters } = useBoardFilterContext();
  const hasClearableFilters = hasActiveBoardFilters(filters);

  return (
    <div className="flex flex-col gap-3">
      <BoardFilterSearchInput />
      <div className="flex flex-wrap items-center gap-2">
        <BoardFilterGroupingChip />
        <BoardFilterStatusGroup />
        <BoardFilterLabelsGroup />
        <BoardFilterAssigneeGroup />
      </div>
      {hasClearableFilters ? (
        <Button
          className="self-start"
          onClick={clearAllFilters}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function BoardFilterSearchInput({ debounce }: { debounce?: number }) {
  const { filters, setSearch } = useBoardFilterContext();
  const inputProps = {
    "aria-label": "Search feedback titles",
    // The persisted query rejects a longer term; keeping the input bounded
    // turns that into an edit the field prevents rather than a failed save.
    maxLength: BOARD_VIEW_SEARCH_MAX_LENGTH,
    placeholder: "Search feedback titles",
  };

  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      {debounce === undefined ? (
        <InputGroupInput
          {...inputProps}
          onChange={(event) => setSearch(event.target.value)}
          value={filters.search ?? ""}
        />
      ) : (
        <DebouncedInputGroupInput
          {...inputProps}
          onChange={setSearch}
          value={filters.search ?? ""}
          wait={debounce}
        />
      )}
    </InputGroup>
  );
}

function BoardFilterTrigger() {
  const {
    currentMemberId,
    filters,
    grouping,
    members,
    postStatuses,
    setGroupBy,
    tags,
    toggleAssignee,
    toggleStatus,
    toggleTag,
  } = useBoardFilterContext();
  const selectedStatuses = new Set(filters.status?.types ?? []);
  const selectedTagIds = new Set(filters.tag?.tagIds ?? []);
  const selectedAssigneeIds = new Set(filters.assigneeMemberIds ?? []);
  const otherMembers = members.filter(
    (member) => member.id !== currentMemberId
  );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Filters"
            className="rounded-full"
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={FilterMailIcon} />
          </Button>
        }
      />
      <MenuPopup className="w-44">
        <MenuGroup>
          <MenuSub>
            <MenuSubTrigger>
              <HugeiconsIcon icon={DashedLineCircleIcon} />
              Status
            </MenuSubTrigger>
            <MenuPortal>
              <MenuSubPopup>
                {postStatuses.map((postStatus) => (
                  <MenuCheckboxItem
                    checked={selectedStatuses.has(postStatus.type)}
                    key={postStatus.type}
                    onCheckedChange={() => {
                      toggleStatus(postStatus.type);
                    }}
                  >
                    {postStatus.label || formatPostStatus(postStatus.type)}
                  </MenuCheckboxItem>
                ))}
              </MenuSubPopup>
            </MenuPortal>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger>
              <HugeiconsIcon icon={Tag01Icon} />
              Labels
            </MenuSubTrigger>
            <MenuPortal>
              <MenuSubPopup>
                {tags.map((tag) => (
                  <MenuCheckboxItem
                    checked={selectedTagIds.has(tag.id)}
                    key={tag.id}
                    onCheckedChange={() => {
                      toggleTag(tag.id);
                    }}
                  >
                    {tag.name}
                  </MenuCheckboxItem>
                ))}
              </MenuSubPopup>
            </MenuPortal>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger>
              <HugeiconsIcon icon={UserCircleIcon} />
              Assigned
            </MenuSubTrigger>
            <MenuPortal>
              <MenuSubPopup>
                {/* The current member gets their own entry rather than a row in
                    the list below: "what am I on" is the common question, and
                    scanning an alphabetized list for your own name to ask it is
                    not. The list then excludes them, so their id appears once. */}
                {currentMemberId ? (
                  <>
                    <MenuCheckboxItem
                      checked={selectedAssigneeIds.has(currentMemberId)}
                      onCheckedChange={() => {
                        toggleAssignee(currentMemberId);
                      }}
                    >
                      Assigned to me
                    </MenuCheckboxItem>
                    <MenuSeparator />
                  </>
                ) : null}
                {otherMembers.length === 0 ? (
                  <MenuItem disabled>No other members</MenuItem>
                ) : (
                  otherMembers.map((member) => (
                    <MenuCheckboxItem
                      checked={selectedAssigneeIds.has(member.id)}
                      key={member.id}
                      onCheckedChange={() => {
                        toggleAssignee(member.id);
                      }}
                    >
                      {member.name}
                    </MenuCheckboxItem>
                  ))
                )}
              </MenuSubPopup>
            </MenuPortal>
          </MenuSub>
        </MenuGroup>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            <HugeiconsIcon icon={GroupItemsIcon} />
            Group by
          </MenuSubTrigger>
          <MenuPortal>
            <MenuSubPopup>
              <BoardGroupingRadioItems
                onChange={setGroupBy}
                value={grouping.field}
              />
            </MenuSubPopup>
          </MenuPortal>
        </MenuSub>
      </MenuPopup>
    </Menu>
  );
}

function BoardFilterGroupingChip() {
  const { grouping, setGroupBy } = useBoardFilterContext();
  const label = boardGroupingLabel(grouping.field);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={GroupItemsIcon}>
        Group by
      </BoardFilterReadonlySegment>
      <BoardFilterMenuSegment ariaLabel={`Group by: ${label}`} label={label}>
        <BoardGroupingRadioItems onChange={setGroupBy} value={grouping.field} />
      </BoardFilterMenuSegment>
    </BoardFilterActiveGroup>
  );
}

function BoardGroupingRadioItems({
  onChange,
  value,
}: {
  onChange: (field: TBoardGroupBy) => void;
  value: TBoardGroupBy;
}) {
  return (
    <MenuRadioGroup
      onValueChange={(next) => {
        if (isBoardGroupBy(next)) {
          onChange(next);
        }
      }}
      value={value}
    >
      {BOARD_GROUPING_OPTIONS.map((option) => (
        <MenuRadioItem closeOnClick key={option.value} value={option.value}>
          {option.label}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

const isBoardGroupBy = (value: string): value is TBoardGroupBy =>
  BOARD_GROUPING_OPTIONS.some((option) => option.value === value);

function BoardFilterActiveRow() {
  const { clearAllFilters, filters } = useBoardFilterContext();
  const hasStatusFilter = filters.status !== null;
  const hasTagFilter = filters.tag !== null;
  const hasAssigneeFilter = (filters.assigneeMemberIds?.length ?? 0) > 0;

  if (!(hasStatusFilter || hasTagFilter || hasAssigneeFilter)) {
    return null;
  }

  return (
    <div className="border-border/60 bg-muted/20 flex flex-col gap-2 rounded-2xl border px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {hasStatusFilter ? <BoardFilterStatusGroup /> : null}
        {hasAssigneeFilter ? <BoardFilterAssigneeGroup /> : null}
        {hasTagFilter ? <BoardFilterLabelsGroup /> : null}
      </div>
      <Button
        className="shrink-0 self-end sm:self-auto"
        onClick={clearAllFilters}
        size="sm"
        type="button"
        variant="ghost"
      >
        Clear
      </Button>
    </div>
  );
}

function BoardFilterStatusGroup() {
  const {
    clearStatusFilter,
    filters,
    postStatuses,
    setStatusOperator,
    toggleStatus,
  } = useBoardFilterContext();
  const selectedStatuses = new Set(filters.status?.types ?? []);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={DashedLineCircleIcon}>
        Status
      </BoardFilterReadonlySegment>
      {/* The operator only means something once a status is selected, so it
          appears with the value rather than sitting beside "Any status". */}
      {filters.status ? (
        <BoardFilterOperatorMenu
          options={STATUS_OPERATOR_OPTIONS}
          setValue={setStatusOperator}
          value={filters.status.operator}
        />
      ) : null}
      <BoardFilterValueMenu
        items={postStatuses.map((postStatus) => ({
          checked: selectedStatuses.has(postStatus.type),
          key: postStatus.type,
          label: postStatus.label || formatPostStatus(postStatus.type),
        }))}
        label={getStatusSummary(filters.status?.types ?? [], postStatuses)}
        onToggle={(status) => {
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          toggleStatus(status as BoardPostStatus);
        }}
      />
      {filters.status ? (
        <BoardFilterClearButton
          ariaLabel="Clear status filter"
          onClick={clearStatusFilter}
        />
      ) : null}
    </BoardFilterActiveGroup>
  );
}

/**
 * The assignee chip.
 *
 * No operator menu: an assignee filter is always "assigned to any of these
 * people". "Assigned to nobody" would need a union with `IS NULL`, which is a
 * different question from the one the board asks — the unassigned posts are
 * what you see when the filter is cleared, not a category to select.
 */
function BoardFilterAssigneeGroup() {
  const { clearAssigneeFilter, filters, members, toggleAssignee } =
    useBoardFilterContext();
  const selectedIds = new Set(filters.assigneeMemberIds ?? []);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={UserCircleIcon}>
        Assigned
      </BoardFilterReadonlySegment>
      <BoardFilterValueMenu
        items={members.map((member) => ({
          checked: selectedIds.has(member.id),
          key: member.id,
          label: member.isCurrentUser ? `${member.name} (you)` : member.name,
        }))}
        label={getAssigneeSummary(filters.assigneeMemberIds ?? [], members)}
        onToggle={toggleAssignee}
      />
      {(filters.assigneeMemberIds?.length ?? 0) > 0 ? (
        <BoardFilterClearButton
          ariaLabel="Clear assignee filter"
          onClick={clearAssigneeFilter}
        />
      ) : null}
    </BoardFilterActiveGroup>
  );
}

function BoardFilterLabelsGroup() {
  const { clearTagFilter, filters, setTagOperator, tags, toggleTag } =
    useBoardFilterContext();
  const selectedTagIds = new Set(filters.tag?.tagIds ?? []);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={Tag01Icon}>
        Labels
      </BoardFilterReadonlySegment>
      {filters.tag ? (
        <BoardFilterOperatorMenu
          options={TAG_OPERATOR_OPTIONS}
          setValue={setTagOperator}
          value={filters.tag.operator}
        />
      ) : null}
      <BoardFilterValueMenu
        items={tags.map((tag) => ({
          checked: selectedTagIds.has(tag.id),
          key: tag.id,
          label: tag.name,
        }))}
        label={getTagSummary(filters.tag?.tagIds ?? [], tags)}
        onToggle={toggleTag}
      />
      {filters.tag ? (
        <BoardFilterClearButton
          ariaLabel="Clear labels filter"
          onClick={clearTagFilter}
        />
      ) : null}
    </BoardFilterActiveGroup>
  );
}

function BoardFilterActiveGroup({ children }: { children: ReactNode }) {
  return (
    <Group className="bg-background/90 max-w-full overflow-x-auto rounded-full">
      {children}
    </Group>
  );
}

function BoardFilterReadonlySegment({
  children,
  icon,
}: {
  children: ReactNode;
  icon: typeof DashedLineCircleIcon;
}) {
  return (
    <GroupText className="border-border bg-background text-foreground rounded-full px-3">
      <HugeiconsIcon className="text-muted-foreground" icon={icon} />
      {children}
    </GroupText>
  );
}

function BoardFilterOperatorMenu<T extends string>({
  options,
  setValue,
  value,
}: {
  options: Array<{ label: string; value: T }>;
  setValue: (value: T) => void;
  value: T;
}) {
  const activeLabel =
    options.find((option) => option.value === value)?.label ??
    options[0]?.label;

  return (
    <BoardFilterMenuSegment label={activeLabel ?? ""}>
      <MenuGroup>
        {options.map((option) => (
          <MenuCheckboxItem
            checked={option.value === value}
            key={option.value}
            onCheckedChange={(checked) => {
              if (checked) {
                setValue(option.value);
              }
            }}
          >
            {option.label}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
    </BoardFilterMenuSegment>
  );
}

function BoardFilterValueMenu({
  items,
  label,
  onToggle,
}: {
  items: Array<{ checked: boolean; key: string; label: string }>;
  label: string;
  onToggle: (value: string) => void;
}) {
  return (
    <BoardFilterMenuSegment className="max-w-48" label={label}>
      <MenuGroup>
        {items.length === 0 ? (
          <MenuItem disabled>No options found</MenuItem>
        ) : (
          items.map((item) => (
            <MenuCheckboxItem
              checked={item.checked}
              key={item.key}
              onCheckedChange={() => {
                onToggle(item.key);
              }}
            >
              {item.label}
            </MenuCheckboxItem>
          ))
        )}
      </MenuGroup>
    </BoardFilterMenuSegment>
  );
}

function BoardFilterMenuSegment({
  ariaLabel,
  children,
  className,
  label,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={ariaLabel}
            className={cn("max-w-48 rounded-full px-3 font-normal", className)}
            size="sm"
            variant="outline"
          >
            <span className="truncate">{label}</span>
          </Button>
        }
      />
      <MenuPopup align="start" className="w-56">
        {children}
      </MenuPopup>
    </Menu>
  );
}

function BoardFilterClearButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className="rounded-full"
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="outline"
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
    </Button>
  );
}

function getStatusSummary(
  statuses: readonly BoardPostStatus[],
  postStatuses: FilterStatus[]
) {
  if (statuses.length === 0) {
    return "Any status";
  }

  if (statuses.length === 1) {
    return (
      postStatuses.find((postStatus) => postStatus.type === statuses[0])
        ?.label || formatPostStatus(statuses[0])
    );
  }

  return `${statuses.length} statuses`;
}

function getTagSummary(tagIds: readonly string[], tags: FilterTag[]) {
  if (tagIds.length === 0) {
    return "Any label";
  }

  const names = tagIds.flatMap((id) => {
    const tag = tags.find((candidate) => candidate.id === id);

    return tag === undefined ? [] : [tag.name];
  });

  return namesOrCount(names, "label", "labels", tagIds.length);
}

function getAssigneeSummary(
  memberIds: readonly string[],
  members: FilterMember[]
) {
  if (memberIds.length === 0) {
    return "Anyone";
  }

  const names = memberIds.flatMap((id) => {
    const member = members.find((candidate) => candidate.id === id);

    return member === undefined ? [] : [member.name];
  });

  return namesOrCount(names, "assignee", "assignees", memberIds.length);
}

export const BoardFilter = {
  ActiveRow: BoardFilterActiveRow,
  Editor: BoardFilterEditor,
  Root: BoardFilterRoot,
  SearchInput: BoardFilterSearchInput,
  Trigger: BoardFilterTrigger,
};
