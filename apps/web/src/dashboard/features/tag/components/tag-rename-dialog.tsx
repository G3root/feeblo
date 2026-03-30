import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { Suspense } from "react";
import { z } from "zod";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { tagCollection } from "~/lib/collections";
import { useTagEditDialogContext } from "../dialog-stores";

export function TagRenameDialog() {
  const store = useTagEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Rename Tag</SheetTitle>
          <SheetDescription>Rename the tag to a new name.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {open ? (
            <Suspense fallback={<TagRenameFormSkeleton />}>
              <TagRenameForm />
            </Suspense>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export const TagEditDialog = TagRenameDialog;

function TagRenameFormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

function TagRenameForm() {
  const organizationId = useOrganizationId();
  const store = useTagEditDialogContext();
  const tagId = useSelector(store, (state) => state.context.data.tagId);

  const { data } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ tag: tagCollection })
        .where((tag) =>
          and(
            eq(tag.tag.id, tagId),
            eq(tag.tag.organizationId, organizationId)
          )
        )
        .orderBy((tag) => tag.tag.createdAt, "desc")
        .limit(1),
    [organizationId, tagId]
  );

  const tag = data[0];

  const form = useAppForm({
    defaultValues: {
      name: tag.name,
      type: tag.type,
    },
    validators: {
      onSubmit: z.object({
        name: z.string(),
        type: z.enum(["FEEDBACK", "CHANGELOG"]),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = tagCollection.update(tagId, (draft) => {
          draft.name = data.value.name;
          draft.type = data.value.type;
        });

        await tx.isPersisted.promise;
        toastManager.add({
          title: "Tag renamed successfully",
          type: "success",
        });
        store.send({ type: "toggle" });
      } catch (_error) {
        toastManager.add({
          title: "Failed to rename tag",
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
