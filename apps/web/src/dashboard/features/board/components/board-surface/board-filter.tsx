import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { Button } from "@feeblo/ui/button";
import { Group, GroupText } from "@feeblo/ui/group";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuPortal,
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

import {
  type BoardStatusOperator,
  type BoardTagOperator,
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

type BoardFilterContextValue = {
  clearAllFilters: () => void;
  /** The signed-in member, for the filter's "Assigned to me" shortcut. */
  currentMemberId: string | undefined;
  clearAssigneeFilter: () => void;
  clearStatusFilter: () => void;
  clearTagFilter: () => void;
  filters: ReturnType<typeof useBoardFilterState>;
  members: FilterMember[];
  organizationId: string;
  postStatuses: Array<{ id: string; type: BoardPostStatus; label: string }>;
  setStatusOperator: (operator: BoardStatusOperator) => void;
  setTagOperator: (operator: BoardTagOperator) => void;
  tags: FilterTag[];
  toggleAssignee: (memberId: string) => void;
  toggleStatus: (status: BoardPostStatus) => void;
  toggleTag: (tagId: string) => void;
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
      "BoardFilter components must be used within BoardFilter.Root"
    );
  }

  return context;
}

function BoardFilterRoot({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const store = useBoardStore();
  const filters = useBoardFilterState();
  const { data: postStatuses } = useOrgPostStatuses(organizationId);
  const { data: tags } = useOrgTags(organizationId);
  const { data: organizationMembers } = useOrgMembers(organizationId);
  const currentMemberId = useCurrentMemberId(organizationId);

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

  const clearStatusFilter = useCallback(() => {
    store.send({ type: "setStatusOperator", operator: "isAnyOf" });
    for (const status of filters.statuses) {
      store.send({ type: "toggleStatusFilter", status });
    }
  }, [filters.statuses, store]);

  const clearTagFilter = useCallback(() => {
    store.send({ type: "setTagOperator", operator: "includeAllOf" });
    for (const tagId of filters.tagIds) {
      store.send({ type: "toggleTagFilter", tagId });
    }
  }, [filters.tagIds, store]);

  const clearAssigneeFilter = useCallback(() => {
    store.send({ type: "clearAssigneeFilter" });
  }, [store]);

  const clearAllFilters = useCallback(() => {
    store.send({ type: "clearFilters" });
  }, [store]);
  const setStatusOperator = useCallback(
    (operator: BoardStatusOperator) => {
      store.send({ type: "setStatusOperator", operator });
    },
    [store]
  );
  const setTagOperator = useCallback(
    (operator: BoardTagOperator) => {
      store.send({ type: "setTagOperator", operator });
    },
    [store]
  );
  const toggleStatus = useCallback(
    (status: BoardPostStatus) => {
      store.send({ type: "toggleStatusFilter", status });
    },
    [store]
  );
  const toggleTag = useCallback(
    (tagId: string) => {
      store.send({ type: "toggleTagFilter", tagId });
    },
    [store]
  );
  const toggleAssignee = useCallback(
    (memberId: string) => {
      store.send({ type: "toggleAssigneeFilter", memberId });
    },
    [store]
  );

  const value = useMemo<BoardFilterContextValue>(
    () => ({
      clearAllFilters,
      clearAssigneeFilter,
      clearStatusFilter,
      clearTagFilter,
      currentMemberId,
      filters,
      members,
      organizationId,
      postStatuses,
      setStatusOperator,
      setTagOperator,
      tags,
      toggleAssignee,
      toggleStatus,
      toggleTag,
    }),
    [
      clearAllFilters,
      clearAssigneeFilter,
      clearStatusFilter,
      clearTagFilter,
      currentMemberId,
      filters,
      members,
      organizationId,
      postStatuses,
      setStatusOperator,
      setTagOperator,
      tags,
      toggleAssignee,
      toggleStatus,
      toggleTag,
    ]
  );

  return (
    <BoardFilterContext.Provider value={value}>
      {children}
    </BoardFilterContext.Provider>
  );
}

function BoardFilterTrigger() {
  const {
    currentMemberId,
    filters,
    members,
    postStatuses,
    tags,
    toggleAssignee,
    toggleStatus,
    toggleTag,
  } = useBoardFilterContext();
  const selectedStatuses = new Set(filters.statuses);
  const selectedTagIds = new Set(filters.tagIds);
  const selectedAssigneeIds = new Set(filters.assigneeMemberIds);
  const otherMembers = members.filter(
    (member) => member.id !== currentMemberId
  );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button className="rounded-full" size="icon-sm" variant="outline">
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
                    key={postStatus.id}
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
      </MenuPopup>
    </Menu>
  );
}

function BoardFilterActiveRow() {
  const { clearAllFilters, filters, tags, members } = useBoardFilterContext();
  const hasStatusFilter = filters.statuses.length > 0;
  const hasTagFilter = filters.tagIds.length > 0;
  const hasAssigneeFilter = filters.assigneeMemberIds.length > 0;

  if (!(hasStatusFilter || hasTagFilter || hasAssigneeFilter)) {
    return null;
  }

  const tagNameMap = new Map(tags.map((tag) => [tag.id, tag.name]));
  const memberNameMap = new Map(
    members.map((member) => [member.id, member.name])
  );

  return (
    <div className="border-border/60 bg-muted/20 flex flex-col gap-2 rounded-2xl border px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {hasStatusFilter ? <BoardFilterStatusGroup /> : null}
        {hasAssigneeFilter ? (
          <BoardFilterAssigneeGroup memberNameMap={memberNameMap} />
        ) : null}
        {hasTagFilter ? (
          <BoardFilterLabelsGroup tagNameMap={tagNameMap} />
        ) : null}
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
    setStatusOperator,
    postStatuses,
    toggleStatus,
  } = useBoardFilterContext();
  const selectedStatuses = new Set(filters.statuses);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={DashedLineCircleIcon}>
        Status
      </BoardFilterReadonlySegment>
      <BoardFilterOperatorMenu
        options={STATUS_OPERATOR_OPTIONS}
        setValue={setStatusOperator}
        value={filters.statusOperator}
      />
      <BoardFilterValueMenu
        items={postStatuses.map((postStatus) => ({
          checked: selectedStatuses.has(postStatus.type),
          key: postStatus.type,
          label: postStatus.label || formatPostStatus(postStatus.type),
        }))}
        label={getStatusSummary(filters.statuses, postStatuses)}
        onToggle={(status) => {
          // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
          toggleStatus(status as BoardPostStatus);
        }}
      />
      <BoardFilterClearButton
        ariaLabel="Clear status filter"
        onClick={clearStatusFilter}
      />
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
function BoardFilterAssigneeGroup({
  memberNameMap,
}: {
  memberNameMap: Map<string, string>;
}) {
  const { clearAssigneeFilter, filters, members, toggleAssignee } =
    useBoardFilterContext();
  const selectedIds = new Set(filters.assigneeMemberIds);

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
        label={getAssigneeSummary(filters.assigneeMemberIds, memberNameMap)}
        onToggle={toggleAssignee}
      />
      <BoardFilterClearButton
        ariaLabel="Clear assignee filter"
        onClick={clearAssigneeFilter}
      />
    </BoardFilterActiveGroup>
  );
}

function BoardFilterLabelsGroup({
  tagNameMap,
}: {
  tagNameMap: Map<string, string>;
}) {
  const { clearTagFilter, filters, setTagOperator, tags, toggleTag } =
    useBoardFilterContext();
  const selectedTagIds = new Set(filters.tagIds);

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={Tag01Icon}>
        Labels
      </BoardFilterReadonlySegment>
      <BoardFilterOperatorMenu
        options={TAG_OPERATOR_OPTIONS}
        setValue={setTagOperator}
        value={filters.tagOperator}
      />
      <BoardFilterValueMenu
        items={tags.map((tag) => ({
          checked: selectedTagIds.has(tag.id),
          key: tag.id,
          label: tag.name,
        }))}
        label={getTagSummary(filters.tagIds, tagNameMap)}
        onToggle={toggleTag}
      />
      <BoardFilterClearButton
        ariaLabel="Clear labels filter"
        onClick={clearTagFilter}
      />
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
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
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
  postStatuses: Array<{ id: string; type: BoardPostStatus; label: string }>
) {
  if (statuses.length === 1) {
    return (
      postStatuses.find((postStatus) => postStatus.type === statuses[0])
        ?.label || formatPostStatus(statuses[0])
    );
  }

  return `${statuses.length} statuses`;
}

function getTagSummary(
  tagIds: readonly string[],
  tagNameMap: Map<string, string>
) {
  if (tagIds.length === 1) {
    return tagNameMap.get(tagIds[0]) ?? "1 label";
  }

  return `${tagIds.length} labels`;
}

function getAssigneeSummary(
  memberIds: readonly string[],
  memberNameMap: Map<string, string>
) {
  if (memberIds.length === 1) {
    return memberNameMap.get(memberIds[0]) ?? "1 assignee";
  }

  return `${memberIds.length} assignees`;
}

export const BoardFilter = {
  ActiveGroup: BoardFilterActiveGroup,
  ActiveRow: BoardFilterActiveRow,
  ClearButton: BoardFilterClearButton,
  OperatorMenu: BoardFilterOperatorMenu,
  ReadonlySegment: BoardFilterReadonlySegment,
  Root: BoardFilterRoot,
  Trigger: BoardFilterTrigger,
  ValueMenu: BoardFilterValueMenu,
};
