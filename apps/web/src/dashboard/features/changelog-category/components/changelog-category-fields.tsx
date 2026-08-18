import { withForm } from "@feeblo/ui/hooks/form";

import { changelogCategoryFormOpts } from "../shared-form";
import { ChangelogCategoryColorField } from "./changelog-category-color-field";

export const ChangelogCategoryFields = withForm({
  ...changelogCategoryFormOpts,
  render: ({ form }) => {
    return (
      <>
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" />}
        </form.AppField>
        <ChangelogCategoryColorField form={form} />
      </>
    );
  },
});
