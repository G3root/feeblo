import { withForm } from "@feeblo/ui/hooks/form";
import { roadmapFormOpts } from "../shared-form";

export const RoadmapFields = withForm({
  ...roadmapFormOpts,
  render: ({ form }) => {
    return (
      <>
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <form.AppField
          children={(field) => <field.TextareaField label="Description" />}
          name="description"
        />
      </>
    );
  },
});
