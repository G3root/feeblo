import type { TBoard } from "@feeblo/domain/board/schema";
import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { IconPickerField } from "@feeblo/ui/icon-picker";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { slugify } from "@feeblo/utils/url";
import { DEFAULT_BOARD_ICON } from "@feeblo/web-shared/icons/defaults";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useRef } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useRenameBoardDialogContext } from "../dialog-stores";
import { boardFormOpts } from "../shared-form";
import { BoardVisibilityField } from "./board-visibility-field";

export function RenameBoardDialog() {
  const store = useRenameBoardDialogContext();

  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Rename Board</SheetTitle>
          <SheetDescription>Rename the board to a new name.</SheetDescription>
        </SheetHeader>
        <RenameBoardForm />
      </SheetPopup>
    </Sheet>
  );
}

function RenameBoardForm() {
  const organizationId = useOrganizationId();
  const { boardCollection } = useDashboardCollections();
  const store = useRenameBoardDialogContext();
  const boardId = useSelector(store, (state) => state.context.data.boardId);

  const { data } = useLiveQuery({
    queryKey: ["board-by-id", boardCollection.id, boardId, organizationId],
    query: (q) =>
      q
        .from({ board: boardCollection })
        .where((board) =>
          and(
            eq(board.board.id, boardId),
            eq(board.board.organizationId, organizationId)
          )
        )
        .findOne(),
  });

  const board = data;

  if (!board) {
    return null;
  }

  return <RenameBoardFormFields board={board} />;
}

/** The row the edit sheet seeds from. */
type RenameBoardRow = Pick<TBoard, "icon" | "name" | "visibility">;

function RenameBoardFormFields({ board }: { board: RenameBoardRow }) {
  const organizationId = useOrganizationId();
  const { boardCollection } = useDashboardCollections();
  const store = useRenameBoardDialogContext();
  const boardId = useSelector(store, (state) => state.context.data.boardId);
  const navigate = useNavigate();
  // Captured when the sheet opened: a refetch can change the row under the
  // form, and a save must compare against the value the editor started with.
  const initialIcon = useRef(board.icon);

  const form = useAppForm({
    ...boardFormOpts,
    defaultValues: {
      name: board.name,
      icon: board.icon,
      visibility: board.visibility,
    },
    onSubmit: async ({ formApi, value }) => {
      try {
        const boardSlug = slugify(value.name);
        const nameIsDirty = formApi.getFieldMeta("name")?.isDirty ?? false;

        const visibilityIsDirty =
          formApi.getFieldMeta("visibility")?.isDirty ?? false;

        // Compare with the value the sheet opened with, not `isDirty`: the
        // form's defaults can be replaced by a refetch, and a save that only
        // changed one field must not repoint the others.
        const iconChanged = value.icon !== initialIcon.current;

        const tx = boardCollection.update(boardId, (draft) => {
          if (nameIsDirty) {
            draft.name = value.name;
            draft.slug = boardSlug;
          }

          if (visibilityIsDirty) {
            draft.visibility = value.visibility;
          }

          if (iconChanged) {
            draft.icon = value.icon;
          }
        });

        await tx.when("settled");
        // The server derives the slug from the saved name, and a concurrent
        // rename may have moved it. Navigate to the row the save returned.
        const savedSlug = boardCollection.get(boardId)?.slug ?? boardSlug;
        toastManager.add({
          title: "Board renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });

        void navigate({
          to: "/$organizationId/board/$boardSlug",
          params: {
            organizationId,
            boardSlug: savedSlug,
          },
        });
      } catch {
        toastManager.add({
          title: "Failed to rename board",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <SheetPanel className="grid gap-4">
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>
        <form.AppField name="icon">
          {(field) => (
            <IconPickerField
              fallbackIcon={DEFAULT_BOARD_ICON}
              label="Choose icon"
              onChange={(icon) => field.handleChange(icon)}
              value={field.state.value}
            />
          )}
        </form.AppField>
        <BoardVisibilityField form={form} />
      </SheetPanel>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <form.AppForm>
          <form.SubscribeButton label="Save" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
