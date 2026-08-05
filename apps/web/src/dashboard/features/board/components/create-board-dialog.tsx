import { BoardId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
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
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import { useEntitlements } from "~/hooks/use-entitlements";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useCreateBoardDialogContext } from "../dialog-stores";
import { boardFormOpts } from "../shared-form";
import { BoardVisibilityField } from "./board-visibility-field";

export function CreateBoardDialog() {
  const store = useCreateBoardDialogContext();

  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Create Board.</SheetTitle>
          <SheetDescription>
            Create a new board to get started.
          </SheetDescription>
        </SheetHeader>
        <CreateBoardForm />
      </SheetPopup>
    </Sheet>
  );
}

function CreateBoardForm() {
  const organizationId = useOrganizationId();
  const { boardCollection } = useDashboardCollections();
  const store = useCreateBoardDialogContext();
  const upgradePlanStore = useUpgradePlanDialogContext();
  const { entitlements } = useEntitlements();

  const { data: boards } = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId)),
    [organizationId]
  );

  const boardCount = boards?.length ?? 0;
  const boardLimit = entitlements.limits.feedbackBoards;
  const atBoardLimit = boardLimit !== null && boardCount >= boardLimit;

  const form = useAppForm({
    ...boardFormOpts,
    onSubmit: async (data) => {
      try {
        const tx = boardCollection.insert({
          id: await BoardId.unsafeGenerate(),
          createdAt: new Date(),
          updatedAt: new Date(),
          name: data.value.name,
          visibility: data.value.visibility,
          slug: slugify(data.value.name),
          organizationId,
          // The server fills in the real creator id from the session.
          creatorId: null,
        });

        await tx.isPersisted.promise;
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Board created successfully",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to create board",
          type: "error",
        });
      }
    },
  });

  if (atBoardLimit) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={SparklesIcon} />
          </EmptyMedia>
          <EmptyTitle>Board limit reached</EmptyTitle>
          <EmptyDescription>
            The {boardLimit} board limit for your plan has been reached. Upgrade
            to create more boards.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              store.send({ type: "toggle" });
              upgradePlanStore.send({ type: "toggle" });
            }}
            size="sm"
            type="button"
          >
            <HugeiconsIcon icon={SparklesIcon} />
            Upgrade plan
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

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
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
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
