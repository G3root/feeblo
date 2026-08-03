import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { EditorProps } from "@feeblo/ui/editor";
import { Field, FieldError } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import { Switch } from "@feeblo/ui/switch";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";
import { PostEditor } from "../post-editor";
import { PostBoardSelect, StatusField } from "../post-field";
import { PostTitleInput } from "../post-title-input";
import { usePostCollections } from "../providers/post-collections-provider";

const Schema = z.object({
  boardId: z.string().trim().min(1, "Board is required"),
  content: z.string().min(1, "Content is required"),
  createMore: z.boolean(),
  statusId: z.string().trim().min(1, "Status is required"),
  title: z.string().trim().min(1, "Title is required"),
});

export const postCreateFormOpts = formOptions({
  defaultValues: {
    boardId: "",
    content: "",
    createMore: false,
    statusId: "",
    title: "",
  },
  validators: {
    onChange: Schema,
  },
});

export const PostTitleField = withForm({
  ...postCreateFormOpts,
  render: ({ form }) => {
    return (
      <form.AppField name="title">
        {(field) => (
          <Field
            className="gap-1"
            dirty={field.state.meta.isDirty}
            invalid={!field.state.meta.isValid}
            name={field.name}
            touched={field.state.meta.isTouched}
          >
            <PostTitleInput
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Enter post title..."
              size="sm"
              value={field.state.value}
            />
            <FieldError
              errors={field.state.meta.errors}
              match={field.state.meta.isTouched && !field.state.meta.isValid}
            />
          </Field>
        )}
      </form.AppField>
    );
  },
});

export const PostContentField = withForm({
  ...postCreateFormOpts,
  props: {} as EditorProps,
  render: ({ form, ...rest }) => {
    const { organizationId } = usePostCollections();
    return (
      <form.AppField name="content">
        {(field) => (
          <Field
            className="flex flex-col items-stretch gap-1"
            dirty={field.state.meta.isDirty}
            invalid={!field.state.meta.isValid}
            name={field.name}
            touched={field.state.meta.isTouched}
          >
            <PostEditor
              content={field.state.value}
              onContentChange={field.handleChange}
              organizationId={organizationId}
              {...rest}
            />
            <FieldError
              errors={field.state.meta.errors}
              match={field.state.meta.isTouched && !field.state.meta.isValid}
            />
          </Field>
        )}
      </form.AppField>
    );
  },
});

export const PostBoardField = withForm({
  ...postCreateFormOpts,
  props: {} as {
    boards: Array<{ id: string; name: string }>;
  },
  render: ({ form, boards }) => {
    return (
      <form.AppField name="boardId">
        {(field) => (
          <Field className="gap-1">
            <div>
              <PostBoardSelect
                boards={boards}
                currentBoardId={field.state.value}
                onValueChange={(nextBoardId) => {
                  if (!nextBoardId) {
                    return;
                  }
                  field.handleChange(nextBoardId);
                }}
              />
            </div>
            <FieldError
              errors={field.state.meta.errors}
              match={field.state.meta.isTouched && !field.state.meta.isValid}
            />
          </Field>
        )}
      </form.AppField>
    );
  },
});

export const PostStatusField = withForm({
  ...postCreateFormOpts,
  props: {} as {
    statuses: Pick<TPostStatus, "id" | "type">[];
  },
  render: ({ form, statuses }) => {
    return (
      <form.AppField name="statusId">
        {(field) => (
          <Field className="gap-1">
            <div>
              <StatusField
                currentStatusId={field.state.value}
                onValueChange={(nextPostStatus) => {
                  if (!nextPostStatus) {
                    return;
                  }
                  field.handleChange(nextPostStatus.id);
                }}
                statuses={statuses}
              />
            </div>
            <FieldError
              errors={field.state.meta.errors}
              match={field.state.meta.isTouched && !field.state.meta.isValid}
            />
          </Field>
        )}
      </form.AppField>
    );
  },
});

export const PostCreateMoreField = withForm({
  ...postCreateFormOpts,
  render: ({ form }) => {
    return (
      <form.AppField name="createMore">
        {(field) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={field.state.value}
              id="create-more"
              onCheckedChange={field.handleChange}
            />
            <Label htmlFor="create-more">Create more</Label>
          </div>
        )}
      </form.AppField>
    );
  },
});
