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

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useRenameBoardDialogContext } from "../dialog-stores";
import { type BoardFormValues, boardFormOpts } from "../shared-form";
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

/**
 * The row the edit sheet seeds from.
 *
 * `icon` is the stored nullable value, not the form's string: the form defaults
 * it to the client's default, and the row itself is allowed to have never
 * picked one.
 */
type RenameBoardRow = {
  icon: string | null;
  name: string;
  visibility: BoardFormValues["visibility"];
};

function RenameBoardFormFields({ board }: { board: RenameBoardRow }) {
  const organizationId = useOrganizationId();
  const { boardCollection } = useDashboardCollections();
  const store = useRenameBoardDialogContext();
  const boardId = useSelector(store, (state) => state.context.data.boardId);
  const navigate = useNavigate();

  const form = useAppForm({
    ...boardFormOpts,
    defaultValues: {
      name: board.name,
      icon: board.icon ?? DEFAULT_BOARD_ICON,
      visibility: board.visibility,
    },
    onSubmit: async (data) => {
      try {
        const boardSlug = slugify(data.value.name);

        const tx = boardCollection.update(boardId, (draft) => {
          draft.name = data.value.name;
          draft.icon = data.value.icon;
          draft.visibility = data.value.visibility;
          draft.slug = boardSlug;
        });

        await tx.when("settled");
        toastManager.add({
          title: "Board renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });

        void navigate({
          to: "/$organizationId/board/$boardSlug",
          params: {
            organizationId,
            boardSlug,
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
