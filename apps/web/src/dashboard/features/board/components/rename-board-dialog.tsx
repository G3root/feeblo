import { Button } from "@feeblo/ui/button";
import { useAppForm } from "@feeblo/ui/hooks/form";
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
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

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
  const navigate = useNavigate();

  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where((board) =>
          and(
            eq(board.board.id, boardId),
            eq(board.board.organizationId, organizationId)
          )
        )
        .orderBy((board) => board.board.createdAt, "desc")
        .limit(1),
    [boardId]
  );

  const board = data[0];

  const form = useAppForm({
    ...boardFormOpts,
    defaultValues: {
      name: board.name,
      visibility: board.visibility,
    },
    onSubmit: async (data) => {
      try {
        const boardSlug = slugify(data.value.name);
        const tx = boardCollection.update(boardId, (draft) => {
          draft.name = data.value.name;
          draft.visibility = data.value.visibility;
          draft.slug = boardSlug;
        });
        await tx.isPersisted.promise;
        toastManager.add({
          title: "Board renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });

        navigate({
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
        form.handleSubmit();
      }}
    >
      <SheetPanel className="grid gap-4">
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
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
