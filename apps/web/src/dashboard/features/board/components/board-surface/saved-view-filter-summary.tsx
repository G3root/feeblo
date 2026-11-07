import type {
  TBoardGrouping,
  TBoardOrderDirection,
  TBoardOrderField,
  TBoardQuery,
  TBoardStatusOperator,
  TBoardTagOperator,
} from "@feeblo/domain-contracts/board-query";
import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { Badge } from "@feeblo/ui/badge";
import {
  DashedLineCircleIcon,
  GroupItemsIcon,
  Search01Icon,
  SortingAZ01Icon,
  Tag01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useOrgMembers } from "~/hooks/use-org-members";
import { useOrgPostStatuses } from "~/hooks/use-org-post-statuses";
import { useOrgTags } from "~/hooks/use-org-tags";

import { namesOrCount } from "../../lib/filter-summary";
import { boardGroupingLabel } from "../../lib/grouping";

const STATUS_OPERATOR_LABELS = {
  isAnyOf: "is any of",
  isNot: "is not",
} satisfies Record<TBoardStatusOperator, string>;

const TAG_OPERATOR_LABELS = {
  excludeIfAllOf: "exclude if all of",
  excludeIfAnyOf: "exclude if any of",
  includeAllOf: "include all of",
  includeAnyOf: "include any of",
} satisfies Record<TBoardTagOperator, string>;

const ORDER_FIELD_LABELS = {
  createdAt: "created date",
  title: "title",
  updatedAt: "updated date",
  upvoteCount: "upvote count",
} satisfies Record<TBoardOrderField, string>;

const ORDER_DIRECTION_LABELS = {
  asc: "ascending",
  desc: "descending",
} satisfies Record<TBoardOrderDirection, string>;

type FilterChip = {
  icon: typeof DashedLineCircleIcon;
  key: string;
  label: string;
};

/**
 * A read-only summary of what a new view will store.
 *
 * The create sheet shows the filters the board is holding rather than editing
 * them: saving a view is "name what is on screen", and the board behind the
 * sheet is the place to change it. The edit sheet uses `BoardFilter.Editor`,
 * which is the same filter vocabulary with a writable value.
 *
 * Names are resolved against the same organization collections the filter menu
 * uses, so a deleted tag or member degrades to a count instead of a raw id.
 */
export function SavedViewFilterSummary({
  organizationId,
  query,
}: {
  organizationId: string;
  query: TBoardQuery;
}) {
  const { data: postStatuses } = useOrgPostStatuses(organizationId);
  const { data: tags } = useOrgTags(organizationId);
  const { data: members } = useOrgMembers(organizationId);

  const statusNames = new Map(
    (postStatuses ?? []).map((postStatus) => [
      postStatus.type,
      postStatus.label || formatPostStatus(postStatus.type),
    ])
  );
  const tagNames = new Map((tags ?? []).map((tag) => [tag.id, tag.name]));
  const memberNames = new Map(
    (members ?? []).map((member) => [
      member.id,
      member.user.name || member.user.email,
    ])
  );

  const { filters } = query;
  const chips: FilterChip[] = [];

  if ((filters.search?.trim() ?? "") !== "") {
    chips.push({
      icon: Search01Icon,
      key: "search",
      label: `Search: “${filters.search}”`,
    });
  }

  if (filters.status) {
    chips.push({
      icon: DashedLineCircleIcon,
      key: "status",
      label: `Status ${STATUS_OPERATOR_LABELS[filters.status.operator]}: ${namesOrCount(
        filters.status.types.map(
          (status) => statusNames.get(status) ?? formatPostStatus(status)
        ),
        "status",
        "statuses"
      )}`,
    });
  }

  if (filters.tag) {
    chips.push({
      icon: Tag01Icon,
      key: "tags",
      label: `Labels ${TAG_OPERATOR_LABELS[filters.tag.operator]}: ${namesOrCount(
        filters.tag.tagIds.flatMap((id) => {
          const name = tagNames.get(id);

          return name === undefined ? [] : [name];
        }),
        "label",
        "labels",
        filters.tag.tagIds.length
      )}`,
    });
  }

  const assigneeMemberIds = filters.assigneeMemberIds ?? [];

  if (assigneeMemberIds.length > 0) {
    chips.push({
      icon: UserCircleIcon,
      key: "assignees",
      label: `Assigned to: ${namesOrCount(
        assigneeMemberIds.flatMap((id) => {
          const name = memberNames.get(id);

          return name === undefined ? [] : [name];
        }),
        "assignee",
        "assignees",
        assigneeMemberIds.length
      )}`,
    });
  }

  return (
    <section aria-labelledby="saved-view-filters-heading" className="space-y-2">
      <h3 className="text-sm font-medium" id="saved-view-filters-heading">
        Applied filters
      </h3>
      {chips.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No filters applied. This view shows everything on this surface.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge
              className="max-w-full gap-1.5"
              key={chip.key}
              size="lg"
              variant="secondary"
            >
              <HugeiconsIcon
                className="text-muted-foreground"
                icon={chip.icon}
                strokeWidth={2}
              />
              <span className="truncate">{chip.label}</span>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The lanes a new view will use.
 *
 * The edit sheet does not need this line: its grouping chip is one of the
 * controls, so the value is already on screen. A create sheet is showing a
 * snapshot, and the grouping is part of what the snapshot will store.
 */
export function SavedViewGroupingSummary({
  grouping,
}: {
  grouping: TBoardGrouping;
}) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <HugeiconsIcon
        className="size-3.5"
        icon={GroupItemsIcon}
        strokeWidth={2}
      />
      Grouped by {boardGroupingLabel(grouping.field)}
    </p>
  );
}

/**
 * The sort order, which neither sheet edits.
 *
 * It is shown beside the create summary and the edit editor so the member can
 * see what the view will order by without a control that would only restate
 * the board's own display popover.
 */
export function SavedViewOrderSummary({
  ordering,
}: {
  ordering: TBoardQuery["ordering"];
}) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <HugeiconsIcon
        className="size-3.5"
        icon={SortingAZ01Icon}
        strokeWidth={2}
      />
      Sorted by {ORDER_FIELD_LABELS[ordering.field]},{" "}
      {ORDER_DIRECTION_LABELS[ordering.direction]}
    </p>
  );
}
