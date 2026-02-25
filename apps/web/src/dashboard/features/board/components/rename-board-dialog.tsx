import { slugify } from "@feeblo/utils/url";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { boardCollection } from "~/lib/collections";
import { useRenameBoardDialogContext } from "../dialog-stores";

export function RenameBoardDialog() {
  const store = useRenameBoardDialogContext();

  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Rename Board</SheetTitle>
          <SheetDescription>Rename the board to a new name.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <RenameBoardForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RenameBoardForm() {
  const organizationId = useOrganizationId();
  const store = useRenameBoardDialogContext();
  const boardId = useSelector(store, (state) => state.context.data.boardId);

  const { data } = useLiveSuspenseQuery(
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
    defaultValues: {
      name: board.name,
      visibility: board.visibility,
    },
    validators: {
      onChange: z.object({
        name: z.string(),
        visibility: z.enum(["PUBLIC", "PRIVATE"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = boardCollection.update(boardId, (draft) => {
          draft.name = data.value.name;
          draft.visibility = data.value.visibility;
          draft.slug = slugify(data.value.name);
        });
        await tx.isPersisted.promise;
        toastManager.add({
          title: "Board renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });
      } catch (_error) {
        toastManager.add({
          title: "Failed to rename board",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppField
        children={(field) => <field.TextField label="Name" />}
        name="name"
      />

      <div className="fixed right-2 bottom-8 w-full sm:max-w-[370px]">
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Save" />
        </form.AppForm>
      </div>
    </form>
  );
}
