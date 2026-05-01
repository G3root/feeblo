import { ArrowDown01Icon, MessageLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useRef, useState } from "react";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Editor, type EmailEditorRef } from "~/components/ui/editor";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { isRichTextContentEmpty } from "./post-editor-utils";

const CommentVisibilitySchema = z.enum(["PUBLIC", "INTERNAL"]);

const Schema = z.object({
  content: z
    .string()
    .refine((value) => !isRichTextContentEmpty(value), "Comment is required"),
  visibility: CommentVisibilitySchema,
});

type TCommentVisibility = z.infer<typeof CommentVisibilitySchema>;
type TSchema = z.infer<typeof Schema>;

type PostCommentComposerProps = {
  disabled?: boolean;
  disabledReason?: string;
  handleAddComment: (value: TSchema) => Promise<void>;
  defaultVisibility?: TSchema["visibility"];
  isAuthenticated: boolean;
  showVisibilityPicker?: boolean;
};

const commentVisibilityCopy: Record<
  TCommentVisibility,
  {
    label: string;
    placeholder: string;
  }
> = {
  PUBLIC: {
    label: "Comment Publicly",
    placeholder: "Add a comment...",
  },
  INTERNAL: {
    label: "Comment Internal",
    placeholder: "Add an internal note...",
  },
};

export function PostCommentComposer({
  disabled = false,
  disabledReason = "Comments are locked for this post.",
  defaultVisibility = "PUBLIC",
  handleAddComment,
  isAuthenticated,
  showVisibilityPicker = false,
}: PostCommentComposerProps) {
  const editorRef = useRef<EmailEditorRef | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const { data: session } = authClient.useSession();

  const userId = session?.user?.id;
  const userName = session?.user?.name;

  const form = useAppForm({
    defaultValues: { content: "", visibility: defaultVisibility },
    validators: {
      onSubmit: Schema,
    },
    onSubmit: async ({ value }) => {
      if (disabled) {
        toastManager.add({ title: disabledReason, type: "error" });
        return;
      }

      if (!(userId && userName)) {
        toastManager.add({ title: "Sign in to comment", type: "error" });
        return;
      }

      try {
        await handleAddComment(value);
        setEditorKey((current) => current + 1);
        form.reset();
        toastManager.add({ title: "Comment added", type: "success" });
      } catch (_error) {
        toastManager.add({ title: "Failed to add comment", type: "error" });
      }
    },
  });

  if (!isAuthenticated) {
    return null;
  }

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <div className="flex rounded-md border p-2">
        <div className="flex w-full flex-col gap-2">
          <form.Subscribe selector={(state) => state.values.visibility}>
            {(visibility) => {
              const selectedCopy = commentVisibilityCopy[visibility];

              return (
                <form.AppField name="content">
                  {(field) => (
                    <Editor
                      className="min-w-0 flex-1"
                      content={field.state.value}
                      editable={!disabled}
                      key={visibility + editorKey}
                      onUpdate={(ref) =>
                        field.handleChange(ref.editor?.getHTML() ?? "")
                      }
                      placeholder={selectedCopy.placeholder}
                      ref={editorRef}
                    />
                  )}
                </form.AppField>
              );
            }}
          </form.Subscribe>

          <div className="flex items-center justify-end">
            <ButtonGroup>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <form.Subscribe selector={(state) => state.values.visibility}>
                    {(visibility) => {
                      const selectedCopy = commentVisibilityCopy[visibility];

                      return (
                        <Button
                          disabled={disabled || isSubmitting}
                          size="sm"
                          type="submit"
                          variant={
                            visibility === "INTERNAL" ? "default" : "outline"
                          }
                        >
                          {selectedCopy.label}
                        </Button>
                      );
                    }}
                  </form.Subscribe>
                )}
              </form.Subscribe>
              {showVisibilityPicker ? (
                <form.AppField name="visibility">
                  {(field) => (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            className="pl-2!"
                            disabled={disabled}
                            size="sm"
                            variant={
                              field.state.value === "INTERNAL"
                                ? "default"
                                : "outline"
                            }
                          >
                            <HugeiconsIcon
                              icon={ArrowDown01Icon}
                              strokeWidth={2}
                            />
                          </Button>
                        }
                      />
                      <DropdownMenuContent className="w-32">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>
                            Comment Visibility
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            onValueChange={(value) =>
                              field.handleChange(
                                CommentVisibilitySchema.parse(value)
                              )
                            }
                            value={field.state.value}
                          >
                            <DropdownMenuRadioItem value="INTERNAL">
                              {commentVisibilityCopy.INTERNAL.label}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="PUBLIC">
                              {commentVisibilityCopy.PUBLIC.label}
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </form.AppField>
              ) : null}
            </ButtonGroup>
          </div>
        </div>
      </div>
      {disabled && (
        <Alert variant="info">
          <HugeiconsIcon icon={MessageLock01Icon} />
          <AlertTitle>Comments locked</AlertTitle>
          <AlertDescription>{disabledReason}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

type PostCommentGuestPromptProps = {
  action: ReactNode;
  description?: string;
  isAuthenticated: boolean;
  title?: string;
};

export function PostCommentGuestPrompt({
  action,
  description = "Sign in to leave a comment or react to this post.",
  isAuthenticated,
  title = "Join the discussion",
}: PostCommentGuestPromptProps) {
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/80 px-4 py-4">
      <p className="font-medium text-sm">{title}</p>
      <p className="mt-1 text-muted-foreground text-sm">{description}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}
