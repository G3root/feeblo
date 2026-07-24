import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
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
import { roadmapCollection } from "~/lib/collections";
import { useEditRoadmapDialogContext } from "../dialog-stores";
import { type RoadmapFormValues, roadmapFormOpts } from "../shared-form";
import { RoadmapFields } from "./roadmap-fields";

export function EditRoadmapDialog() {
  const store = useEditRoadmapDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Edit Roadmap</SheetTitle>
          <SheetDescription>Update the roadmap details.</SheetDescription>
        </SheetHeader>
        <EditRoadmapForm />
      </SheetPopup>
    </Sheet>
  );
}

function EditRoadmapForm() {
  const organizationId = useOrganizationId();
  const store = useEditRoadmapDialogContext();
  const data = useSelector(store, (state) => state.context.data);
  const navigate = useNavigate({ from: "/$organizationId/roadmap/$slug" });

  const roadmapQuery = useLiveQuery(
    (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            eq(roadmap.id, data.roadmapId)
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          name: roadmap.name,
          slug: roadmap.slug,
          visibility: roadmap.visibility,
        }))
        .findOne(),
    [organizationId, data.roadmapId]
  );

  if (!roadmapQuery.data) {
    throw new Error("not found");
  }

  const defaultValues: RoadmapFormValues = {
    ...roadmapQuery.data,
  };

  const form = useAppForm({
    ...roadmapFormOpts,
    defaultValues,
    onSubmit: async ({ value }) => {
      try {
        const oldSlug = roadmapQuery.data?.slug;
        const newSlugifiedValue = slugify(value.name);
        const tx = roadmapCollection.update(data.roadmapId, (draft) => {
          draft.name = value.name;
          draft.slug = newSlugifiedValue;
          draft.description = value.description ?? null;
          draft.visibility = value.visibility;
          draft.updatedAt = new Date();
        });

        await tx.isPersisted.promise;

        //TODO fix this race condition
        if (newSlugifiedValue !== oldSlug) {
          await navigate({
            to: "/$organizationId/roadmap/$slug",
            params: { organizationId, slug: newSlugifiedValue },
            replace: true,
          });
        }
        store.send({ type: "toggle" });
        toastManager.add({
          title: "Roadmap updated successfully",
          type: "success",
        });
      } catch (_error) {
        toastManager.add({
          title: "Failed to update roadmap",
          type: "error",
        });
      }
    },
  });

  return (
    <form
      className="contents"
      data-slot="form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <SheetPanel className="grid gap-4">
        <RoadmapFields form={form} />
      </SheetPanel>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label="Save" />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
