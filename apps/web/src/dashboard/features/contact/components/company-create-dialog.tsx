import { useAppForm } from "@feeblo/ui/hooks/form";
import { CompanyId } from "@feeblo/id";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useCompanyCreateDialogContext } from "../dialog-stores";

export function CompanyCreateDialog() {
  const store = useCompanyCreateDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create company</SheetTitle>
          <SheetDescription>Add a company to this workspace.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <CompanyCreateForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CompanyCreateForm() {
  const organizationId = useOrganizationId();
  const { companyCollection } = useDashboardCollections();
  const store = useCompanyCreateDialogContext();
  const form = useAppForm({
    defaultValues: { name: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, "Enter a company name"),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = companyCollection.insert({
          id: await CompanyId.unsafeGenerate(),
          organizationId,
          externalId: null,
          name: data.value.name,
          avatar: null,
          externalCreatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await tx.isPersisted.promise;
        form.reset();
        store.send({ type: "toggle" });
        toastManager.add({ title: "Company created", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to create company", type: "error" });
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="space-y-4">
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Create company" />
        </form.AppForm>
      </div>
    </form>
  );
}
