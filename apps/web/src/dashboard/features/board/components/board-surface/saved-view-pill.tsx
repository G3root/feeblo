import { mergeProps } from "@base-ui/react/merge-props";
import { useSortable } from "@dnd-kit/react/sortable";
import type { TSavedView } from "@feeblo/domain/saved-view/schema";
import { Button } from "@feeblo/ui/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@feeblo/ui/context-menu";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { toggleVariants } from "@feeblo/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@feeblo/ui/tooltip";
import { cn } from "@feeblo/ui/utils";
import {
  Copy01Icon,
  Delete02Icon,
  Edit01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { memo, type ReactNode, type Ref } from "react";

/** What a pill's menus can do to the view they belong to. */
export type SavedViewActions = {
  onDelete: (view: TSavedView) => void;
  onDuplicate: (view: TSavedView) => void;
  onEdit: (view: TSavedView) => void;
};

/**
 * A link to a saved view, on whichever surface the strip is rendered for.
 *
 * One component rather than a link per call site: the two route ids are
 * different literals, so the branch has to exist somewhere, and spreading a
 * union of `{ to, params }` pairs onto `Link` is not assignable — its props are
 * a union discriminated on `to`.
 */
export function SavedViewLink({
  activeOptions,
  activeProps,
  boardSlug,
  children,
  className,
  onClick,
  organizationId,
  ref,
  viewId,
}: {
  activeOptions?: { exact: boolean };
  activeProps?: Record<string, string>;
  boardSlug: string | undefined;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  organizationId: string;
  ref?: Ref<HTMLAnchorElement>;
  viewId: string;
}) {
  if (boardSlug) {
    return (
      <Link
        activeOptions={activeOptions}
        activeProps={activeProps}
        className={className}
        onClick={onClick}
        params={{ boardSlug, organizationId, viewId }}
        ref={ref}
        to="/$organizationId/board/$boardSlug/view/$viewId"
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      activeOptions={activeOptions}
      activeProps={activeProps}
      className={className}
      onClick={onClick}
      params={{ organizationId, viewId }}
      ref={ref}
      to="/$organizationId/feedback/view/$viewId"
    >
      {children}
    </Link>
  );
}

/**
 * One saved view in the strip: a link to its path, a drag source, and a
 * right-click menu.
 *
 * The three interactions share one element because they are three gestures on
 * the same target: click navigates, press-and-move reorders, right-click opens
 * the actions. `draggable={false}` keeps the browser's own link drag from
 * competing with the sortable one.
 *
 * Memoized, and the callbacks it receives are stable, so opening the dialog,
 * toggling the popover or measuring the strip does not re-render every pill.
 * The name ellipsizes inside `max-w-40`, so a long name truncates inside its own
 * tab instead of costing the strip another tab's worth of width.
 *
 * The sortable ref is on the wrapper — the strip's flex item — not on the link
 * inside it. The plugin translates the element it owns, and a transform applied
 * to the link left the wrapper (and the gap it carries) where it was, so after a
 * drop the two swapped pills sat flush: the transform was a gap out of step with
 * the layout that had already moved.
 */
export const SavedViewPill = memo(function SavedViewPill({
  boardSlug,
  index,
  isClipped,
  onDelete,
  onDuplicate,
  onEdit,
  organizationId,
  view,
}: SavedViewActions & {
  boardSlug: string | undefined;
  index: number;
  isClipped: boolean;
  organizationId: string;
  view: TSavedView;
}) {
  const { isDragging, ref } = useSortable({ id: view.id, index });

  const pillClassName = cn(
    "flex shrink-0",
    // `invisible` keeps the pill's layout, so the next measurement still sees
    // its width — the strip is capped to the visible tabs, so the clipped ones
    // do not leave a gap where they would have been.
    isClipped && "invisible",
    isDragging && "z-10 opacity-80"
  );

  return (
    <ContextMenu>
      {/* The tooltip wraps the pill's wrapper rather than the link: Base UI's
          trigger has to own the element it listens on, and that element is also
          the sortable one. The drag still starts from the link — the sensor's
          `preventActivation` is off and its delay/distance constraints keep a
          plain click a click. */}
      <Tooltip>
        <TooltipTrigger
          render={(triggerProps) => (
            <ContextMenuTrigger
              // Base UI's tooltip trigger and dnd-kit both want a ref to this
              // node; `mergeProps` composes them instead of one winning.
              {...mergeProps(triggerProps, { className: pillClassName, ref })}
            >
              <SavedViewLink
                activeOptions={{ exact: true }}
                activeProps={{ "data-pressed": "true" }}
                boardSlug={boardSlug}
                className={cn(
                  toggleVariants({ size: "sm", variant: "outline" }),
                  "cursor-grab active:cursor-grabbing"
                )}
                organizationId={organizationId}
                viewId={view.id}
              >
                <span className="max-w-40 truncate">{view.name}</span>
              </SavedViewLink>
            </ContextMenuTrigger>
          )}
        />
        <TooltipPopup align="start" className="max-w-72">
          {/* The pill truncates at 160px, so the tooltip is where a long name
              is readable in full — and the only place the description appears
              outside the overflow menu. */}
          <p className="text-xs font-medium">{view.name}</p>
          {view.description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {view.description}
            </p>
          ) : null}
        </TooltipPopup>
      </Tooltip>
      <ContextMenuPopup align="start">
        <ContextMenuItem onClick={() => onEdit(view)}>
          <HugeiconsIcon icon={Edit01Icon} />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate(view)}>
          <HugeiconsIcon icon={Copy01Icon} />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onDelete(view)} variant="destructive">
          <HugeiconsIcon icon={Delete02Icon} />
          Delete
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
});

/**
 * The three-dots menu a saved view gets in the overflow popover.
 *
 * Separate from the context menu above rather than shared: the two use
 * different primitives (a `ContextMenuItem` and a `MenuItem`), and a polymorphic
 * item component would be more machinery than the six duplicated lines are
 * worth.
 */
export function SavedViewRowMenu({
  onDelete,
  onDuplicate,
  onEdit,
  view,
}: SavedViewActions & { view: TSavedView }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Actions for ${view.name}`}
            className="shrink-0"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => onEdit(view)}>
          <HugeiconsIcon icon={Edit01Icon} />
          Edit
        </MenuItem>
        <MenuItem onClick={() => onDuplicate(view)}>
          <HugeiconsIcon icon={Copy01Icon} />
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => onDelete(view)} variant="destructive">
          <HugeiconsIcon icon={Delete02Icon} />
          Delete
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
