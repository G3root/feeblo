import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Checkbox } from "~/components/ui/checkbox";
import {
  CHANGELOG_STATUS_LABELS,
  CHANGELOG_STATUSES,
  type ChangelogStatus,
} from "../constants";
import { ChangelogStatusBadge } from "./changelog-status";

type TChangelogListItem = {
  id: string;
  title: string;
  slug: string;
  content: string;
  status: ChangelogStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  user: {
    name: string | null;
  };
};

export function ChangelogListView({
  changelogs,
  organizationId,
}: {
  changelogs: TChangelogListItem[];
  organizationId: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const grouped = CHANGELOG_STATUSES.map((status) => ({
    key: status,
    label: CHANGELOG_STATUS_LABELS[status],
    items: changelogs.filter((changelog) => changelog.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <section>
      <Accordion
        className="w-full rounded-none"
        defaultValue={grouped.map((group) => group.key)}
        multiple
      >
        {grouped.map((group) => (
          <AccordionItem
            className="border-border border-b last:border-b-0"
            key={group.key}
            value={group.key}
          >
            <AccordionTrigger className="rounded-none border-0 bg-linear-to-r from-muted/70 via-muted/30 to-transparent px-4 py-2.5 hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  className="size-4 text-muted-foreground group-aria-expanded/accordion-trigger:hidden"
                  icon={ArrowDown01Icon}
                  strokeWidth={2}
                />
                <HugeiconsIcon
                  className="hidden size-4 text-muted-foreground group-aria-expanded/accordion-trigger:inline"
                  icon={ArrowUp01Icon}
                  strokeWidth={2}
                />
                <h3 className="font-medium text-sm">{group.label}</h3>
                <span className="text-muted-foreground text-xs">
                  {group.items.length}
                </span>
              </div>
            </AccordionTrigger>

            <AccordionContent className="h-auto pb-0" panelClassName="px-0">
              {group.items.map((changelog) => (
                <ChangelogRowItem
                  changelog={changelog}
                  key={changelog.id}
                  organizationId={organizationId}
                  selected={selectedIds.includes(changelog.id)}
                  toggleSelected={(checked) => {
                    setSelectedIds((current) => {
                      if (checked) {
                        return current.includes(changelog.id)
                          ? current
                          : [...current, changelog.id];
                      }

                      return current.filter((id) => id !== changelog.id);
                    });
                  }}
                />
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function ChangelogRowItem({
  changelog,
  organizationId,
  selected,
  toggleSelected,
}: {
  changelog: TChangelogListItem;
  organizationId: string;
  selected: boolean;
  toggleSelected: (checked: boolean) => void;
}) {
  return (
    <div
      className={`border-b transition-colors last:border-b-0 ${
        selected ? "bg-muted/30" : ""
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3 px-4 py-4">
          <Checkbox
            aria-label={`Select ${changelog.title}`}
            checked={selected}
            onCheckedChange={(checked) => toggleSelected(Boolean(checked))}
          />
          <Link
            className="min-w-0 flex-1 space-y-2"
            params={{ organizationId, changelogSlug: changelog.slug }}
            to="/$organizationId/changelog/$changelogSlug"
          >
            <div className="flex items-center gap-2">
              <h4 className="truncate font-medium text-sm">
                {changelog.title}
              </h4>
              <ChangelogStatusBadge status={changelog.status} />
            </div>
            <p className="line-clamp-2 text-muted-foreground text-sm leading-6">
              {getChangelogExcerpt(changelog.content)}
            </p>
          </Link>
        </div>

        <div className="shrink-0 space-y-1 px-4 pb-4 text-muted-foreground text-xs md:px-4 md:pt-4 md:pb-0 md:text-right">
          <p>{getScheduleLabel(changelog)}</p>
          <p>{changelog.user.name ?? "Unknown author"}</p>
        </div>
      </div>
    </div>
  );
}

function getChangelogExcerpt(content: string) {
  const textOnly = content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return textOnly || "No content yet.";
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function getScheduleLabel(changelog: {
  status: ChangelogStatus;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  updatedAt: Date;
}) {
  if (changelog.status === "published" && changelog.publishedAt) {
    return `Published ${formatDate(changelog.publishedAt)}`;
  }

  if (changelog.status === "scheduled" && changelog.scheduledAt) {
    return `Scheduled ${formatDate(changelog.scheduledAt)}`;
  }

  return `Updated ${formatDate(changelog.updatedAt)}`;
}
