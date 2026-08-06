import { withForm } from "@feeblo/ui/hooks/form";
import { changelogCategoryFormOpts } from "../shared-form";
import { ChangelogCategoryColorField } from "./changelog-category-color-field";

export const ChangelogCategoryFields = withForm({
  ...changelogCategoryFormOpts,
  render: ({ form }) => {
    return (
      <>
        <form.AppField
          children={(field) => <field.TextField label="Name" />}
          name="name"
        />
        <ChangelogCategoryColorField form={form} />
      </>
    );
  },
});
