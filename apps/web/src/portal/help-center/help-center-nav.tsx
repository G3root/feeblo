import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@feeblo/ui/breadcrumb";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { TablerIcon } from "@feeblo/ui/icon-picker";
import { cn } from "@feeblo/ui/utils";
import { helpCenterTopicIconName } from "@feeblo/web-shared/icons/defaults";
import { ChevronRightIcon, File02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { HelpCenterNavArticle, HelpCenterNavSection } from "./content";

/**
 * The portal's help center navigation.
 *
 * One tree, in the order the workspace published: its sections, each opening in
 * place to show its articles. It renders beside an article rather than only on
 * the index because an article is where a reader decides what to read next, and
 * sending them back to the index to find out is the long way round.
 *
 * Every section is independently collapsible (`Collapsible`, not an accordion):
 * a reader comparing two sections should not have one close because they opened
 * the other.
 */
export function HelpCenterNav({
  sections,
  activeArticleId,
  activeSectionKey,
  className,
}: {
  readonly sections: ReadonlyArray<HelpCenterNavSection>;
  readonly activeArticleId?: string;
  /** The section holding the article being read, opened on arrival. */
  readonly activeSectionKey?: string;
  readonly className?: string;
}) {
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () => new Set(activeSectionKey === undefined ? [] : [activeSectionKey])
  );

  // Moving to an article in another section opens that one too. The reader's
  // own choices stay as they are: navigating is not a reason to close a section
  // they were reading.
  useEffect(() => {
    if (activeSectionKey === undefined) {
      return;
    }

    setOpenSections((open) =>
      open.has(activeSectionKey) ? open : new Set(open).add(activeSectionKey)
    );
  }, [activeSectionKey]);

  if (sections.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Help center" className={className}>
      <Link
        className="text-muted-foreground hover:text-foreground mb-2 flex items-center px-2 text-xs font-medium transition-colors"
        to="/s/help"
      >
        All sections
      </Link>
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <li key={section.key}>
            <HelpCenterNavSectionRow
              activeArticleId={activeArticleId}
              isActiveSection={section.key === activeSectionKey}
              isOpen={openSections.has(section.key)}
              onOpenChange={(open) =>
                setOpenSections((previous) => {
                  const next = new Set(previous);

                  if (open) {
                    next.add(section.key);
                  } else {
                    next.delete(section.key);
                  }

                  return next;
                })
              }
              section={section}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One section: a row that opens it.
 *
 * One target, not two, because a section has no page of its own on this portal —
 * the index lists every section inline — so a label that navigated somewhere
 * would be a link to the page the reader is already on, only less obviously. The
 * row is a button whose expanded state the chevron and `aria-expanded` both
 * describe.
 */
function HelpCenterNavSectionRow({
  section,
  isOpen,
  isActiveSection,
  activeArticleId,
  onOpenChange,
}: {
  readonly section: HelpCenterNavSection;
  readonly isOpen: boolean;
  readonly isActiveSection: boolean;
  readonly activeArticleId?: string;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible onOpenChange={onOpenChange} open={isOpen}>
      <CollapsibleTrigger
        className={cn(
          "hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 ps-1 pe-2 text-start text-sm transition-colors data-panel-open:[&_[data-nav-chevron]]:rotate-90",
          isActiveSection
            ? "text-foreground font-medium"
            : "text-muted-foreground"
        )}
      >
        {section.isTopic ? (
          <TablerIcon
            className="text-muted-foreground size-4"
            name={helpCenterTopicIconName(section.icon)}
          />
        ) : (
          <HugeiconsIcon
            aria-hidden="true"
            className="text-muted-foreground size-4"
            icon={File02Icon}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{section.name}</span>
        <span className="text-muted-foreground/70 shrink-0 text-xs tabular-nums">
          {section.articles.length}
        </span>
        <HugeiconsIcon
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200"
          data-nav-chevron=""
          icon={ChevronRightIcon}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="border-border/70 ms-3.5 mt-0.5 mb-2 border-s">
          {section.articles.map((article) => (
            <HelpCenterNavArticleRow
              article={article}
              isActive={article.id === activeArticleId}
              key={article.id}
            />
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** One article in a branch: the current page marked on the branch's own line. */
function HelpCenterNavArticleRow({
  article,
  isActive,
}: {
  readonly article: HelpCenterNavArticle;
  readonly isActive: boolean;
}) {
  return (
    <li className="relative">
      {isActive ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-1 -start-px w-0.5 rounded-full"
        />
      ) : null}
      <Link
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "hover:bg-muted/60 block rounded-e-md py-1.5 ps-4 pe-2 text-[13px] leading-5 transition-colors",
          isActive
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        )}
        params={{ articleSlug: article.slug }}
        to="/s/help/articles/$articleSlug"
      >
        {article.title}
      </Link>
    </li>
  );
}

/**
 * Where the reader is.
 *
 * Two parts, not three: a section has no page of its own on the portal — the
 * index lists every section inline — so a crumb between the help center and the
 * article would be a link to nowhere. The section is named above the title
 * instead.
 */
export function HelpCenterBreadcrumbs({ title }: { readonly title: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs sm:text-xs">
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/s/help" />}>
            Help center
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
