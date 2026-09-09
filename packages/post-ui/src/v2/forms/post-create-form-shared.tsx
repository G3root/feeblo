import {
  POST_CONTENT_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "@feeblo/domain/content-limits";
import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import type { EditorProps } from "@feeblo/ui/editor";
import { Field, FieldError } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import { Switch } from "@feeblo/ui/switch";
import { formOptions } from "@tanstack/react-form";
import { lazy, Suspense } from "react";
import { z } from "zod";

import { m } from "../../paraglide/messages.js";
import { emptyOnBehalfAuthor } from "../contact-combobox/contact-combobox";
import { PostBoardSelect, StatusField } from "../post-field";
import { PostTitleInput } from "../post-title-input";
import { usePostCollections } from "../providers/post-collections-provider";

// Per-field schemas: reused by the form's function validator, which checks
// each field independently (see postCreateFormOpts).
const BoardIdField = z
  .string()
  .trim()
  .min(1, { error: () => m.agent_real_tuna() });
const ContentField = z
  .string()
  .min(1, { error: () => m.flat_stout_thrush() })
  .max(POST_CONTENT_MAX_LENGTH, {
    error: () => m.upper_sea_thrush({ count: POST_CONTENT_MAX_LENGTH }),
  });
const StatusIdField = z
  .string()
  .trim()
  .min(1, { error: () => m.slow_legal_kitten() });
const TitleField = z
  .string()
  .trim()
  .min(1, { error: () => m.mellow_fit_stork() })
  .max(POST_TITLE_MAX_LENGTH, {
    error: () => m.game_quiet_mule({ count: POST_TITLE_MAX_LENGTH }),
  });

// The composed object schema was dropped: the function validator below checks
// each field against its own schema, and `author` is server-validated.

// The rich-text editor (prosekit + friends) is the heaviest module in the
// create flow. The dialog opens first with fields + skeleton; the editor
// streams in, so opening never waits on it.
const PostEditor = lazy(() =>
  import("../post-editor").then((module) => ({
    default: module.PostEditor,
  }))
);

export const postCreateFormOpts = formOptions({
  defaultValues: {
    author: emptyOnBehalfAuthor,
    boardId: "",
    content: "",
    createMore: false,
    statusId: "",
    title: "",
  },
  validators: {
    // A function validator (not a zod schema) because TanStack requires the
    // validator's input AND output types to equal the form values exactly,
    // which no zod schema can do for an optional-shaped `author` under
    // exactOptionalPropertyTypes. Each validated field is checked against its
    // own schema; the author key is server-validated.
    onChange: ({ value }) => {
      const fieldErrors: Record<string, string> = {};
      const fieldChecks = [
        ["boardId", BoardIdField, value.boardId],
        ["content", ContentField, value.content],
        ["statusId", StatusIdField, value.statusId],
        ["title", TitleField, value.title],
      ] as const;
      for (const [key, fieldSchema, fieldValue] of fieldChecks) {
        const parsed = fieldSchema.safeParse(fieldValue);
        if (!parsed.success) {
          fieldErrors[key] =
            parsed.error.issues[0]?.message ?? m.sweet_direct_buzzard();
        }
      }
      // Field-scoped errors must ride under `fields` (GlobalFormValidationError);
      // a flat record would surface as a single global form error.
      return Object.keys(fieldErrors).length > 0
        ? { fields: fieldErrors }
        : undefined;
    },
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
              maxLength={POST_TITLE_MAX_LENGTH}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={m.spicy_plain_newt()}
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
  // SAFETY: Empty-state placeholder for the generic container until real data is set.
  props: {} as EditorProps & {
    assetOwner?: "organization" | "user";
  },
  render: function PostContentFieldRender({
    assetOwner = "organization",
    form,
    ...rest
  }) {
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
            <Suspense
              fallback={
                <div className="bg-muted h-36 animate-pulse rounded-xl" />
              }
            >
              <PostEditor
                content={field.state.value}
                onContentChange={field.handleChange}
                {...(assetOwner === "organization" ? { organizationId } : {})}
                {...rest}
              />
            </Suspense>
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
  props: {
    // SAFETY: [] satisfies the boards contract; consumers always provide the
    // real board list when mounting the field.
    boards: [] as Array<{ id: string; name: string }>,
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
  props: {
    // SAFETY: [] satisfies the statuses contract; consumers always provide the
    // real status list when mounting the field.
    statuses: [] as Pick<TPostStatus, "id" | "label" | "type">[],
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
            <Label htmlFor="create-more">{m.house_busy_deer()}</Label>
          </div>
        )}
      </form.AppField>
    );
  },
});
