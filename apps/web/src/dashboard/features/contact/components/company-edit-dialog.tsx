import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@feeblo/ui/sheet";
import { toastManager } from "@feeblo/ui/toast";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { z } from "zod";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useCompanyEditDialogContext } from "../dialog-stores";

export function CompanyEditDialog() {
  const store = useCompanyEditDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <Sheet onOpenChange={() => store.send({ type: "toggle" })} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit company</SheetTitle>
          <SheetDescription>Update this company&apos;s name.</SheetDescription>
        </SheetHeader>
        <div className="p-4">{open ? <CompanyEditFormLoader /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}

function CompanyEditFormLoader() {
  const organizationId = useOrganizationId();
  const { companyCollection } = useDashboardCollections();
  const store = useCompanyEditDialogContext();
  const companyId = useSelector(store, (state) => state.context.data.companyId);
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) =>
          and(
            eq(company.id, companyId),
            eq(company.organizationId, organizationId)
          )
        )
        .limit(1),
    [companyId, organizationId]
  );
  const company = data?.[0];

  if (!company) {
    return null;
  }

  return <CompanyEditForm companyId={companyId} companyName={company.name} />;
}

function CompanyEditForm({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const { companyCollection } = useDashboardCollections();
  const store = useCompanyEditDialogContext();

  const form = useAppForm({
    defaultValues: { name: companyName },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, "Enter a company name"),
      }),
    },
    onSubmit: async (data) => {
      try {
        const tx = companyCollection.update(companyId, (draft) => {
          draft.name = data.value.name;
          draft.updatedAt = new Date();
        });

        await tx.isPersisted.promise;
        store.send({ type: "toggle" });
        toastManager.add({ title: "Company updated", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to update company", type: "error" });
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
          <form.SubscribeButton className="w-full" label="Save changes" />
        </form.AppForm>
      </div>
    </form>
  );
}
