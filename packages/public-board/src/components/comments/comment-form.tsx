import { onMount } from "solid-js";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { TextField, TextFieldTextArea } from "../ui/text-field";

interface CommentFormProps {
  buttonText: string;
  currentUser: {
    initials: string;
  };
}

export function CommentForm({ currentUser, buttonText }: CommentFormProps) {
  let textareaRef: HTMLTextAreaElement | undefined;
  onMount(() => {
    textareaRef?.focus();
  });
  return (
    <div class="flex items-start gap-2">
      <Avatar class="mt-1 hidden sm:flex">
        <AvatarFallback>{currentUser.initials}</AvatarFallback>
      </Avatar>
      <div class="flex-1 rounded-lg border bg-card p-1 text-card-foreground">
        <TextField>
          <TextFieldTextArea
            class="w-full border-none"
            ref={textareaRef}
            rows={2}
          />
        </TextField>
        <div class="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <div class="ml-auto">
            <Button>{buttonText}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
