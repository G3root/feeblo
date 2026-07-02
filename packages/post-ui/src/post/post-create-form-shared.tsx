import type { TPostStatus } from "@feeblo/domain/post-status/schema";
import { Editor, type EditorProps, EditorProvider } from "@feeblo/ui/editor";
import { withForm } from "@feeblo/ui/hooks/form";
import { Label } from "@feeblo/ui/label";
import { Switch } from "@feeblo/ui/switch";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";
import { PostBoardSelect } from "./post-board-select";
import { isRichTextContentEmpty } from "./post-editor-utils";
import { StatusSelect } from "./post-properties";
import { PostTitleInput } from "./post-title-input";

const Schema = z.object({
  boardId: z.string().trim().min(1, "Board is required"),
  content: z
    .string()
    .refine((value) => !isRichTextContentEmpty(value), "Content is required"),
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
          <PostTitleInput
            name={field.name}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="Enter post title..."
            size="sm"
            value={field.state.value}
          />
        )}
      </form.AppField>
    );
  },
});

export const PostContentField = withForm({
  ...postCreateFormOpts,
  props: {} as EditorProps,
  render: ({ form, ...rest }) => {
    return (
      <form.AppField name="content">
        {(field) => (
          <EditorProvider defaultValue={{ postContent: field.state.value }}>
            <Editor
              onChange={(doc) => field.handleChange(doc)}
              placeholder="Type '/' for commands or start typing a description..."
              {...rest}
            />
          </EditorProvider>
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
          <StatusSelect
            currentStatusId={field.state.value}
            onValueChange={(nextPostStatus) => {
              if (!nextPostStatus) {
                return;
              }
              field.handleChange(nextPostStatus.id);
            }}
            statuses={statuses}
          />
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
