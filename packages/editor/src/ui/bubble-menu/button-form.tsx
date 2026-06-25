import * as React from "react";
import { CheckIcon, UnlinkIcon } from "../icons";
import { useBubbleMenuContext } from "./context";
import { focusEditor, getUrlFromString } from "./utils";

export interface BubbleMenuButtonFormProps {
  className?: string;
  onLinkApply?: (href: string) => void;
  onLinkRemove?: () => void;
  validateUrl?: (value: string) => string | null;
}

export function BubbleMenuButtonForm({
  className,
  validateUrl,
  onLinkApply,
  onLinkRemove,
}: BubbleMenuButtonFormProps) {
  const { editor, isEditing, setIsEditing } = useBubbleMenuContext();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const buttonHref = (editor.getAttributes("button").href as string) ?? "";
  const displayHref = buttonHref === "#" ? "" : buttonHref;
  const [inputValue, setInputValue] = React.useState(displayHref);

  React.useEffect(() => {
    if (!isEditing) {
      return;
    }
    const currentHref = (editor.getAttributes("button").href as string) ?? "";
    const display = currentHref === "#" ? "" : currentHref;
    setInputValue(display);
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [isEditing, editor]);

  React.useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsEditing(false);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        const form = formRef.current;
        const submitEvent = new Event("submit", {
          bubbles: true,
          cancelable: true,
        });
        form.dispatchEvent(submitEvent);
        setIsEditing(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing, setIsEditing]);

  if (!isEditing) {
    return null;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const value = inputValue.trim();

    if (value === "") {
      editor.commands.updateButton({ href: "#" });
      setIsEditing(false);
      focusEditor(editor);
      onLinkRemove?.();
      return;
    }

    const validate = validateUrl ?? getUrlFromString;
    const finalValue = validate(value);

    if (!finalValue) {
      editor.commands.updateButton({ href: "#" });
      setIsEditing(false);
      focusEditor(editor);
      onLinkRemove?.();
      return;
    }

    editor.commands.updateButton({ href: finalValue });
    setIsEditing(false);
    focusEditor(editor);
    onLinkApply?.(finalValue);
  }

  function handleUnlink(e: React.MouseEvent) {
    e.stopPropagation();
    editor.commands.updateButton({ href: "#" });
    setIsEditing(false);
    focusEditor(editor);
    onLinkRemove?.();
  }

  return (
    <form
      className={className}
      data-re-btn-bm-form=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <input
        data-re-btn-bm-input=""
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={(e) => e.stopPropagation()}
        placeholder="Paste a link"
        ref={inputRef}
        type="text"
        value={inputValue}
      />

      {displayHref ? (
        <button
          aria-label="Remove link"
          data-re-btn-bm-unlink=""
          onClick={handleUnlink}
          type="button"
        >
          <UnlinkIcon />
        </button>
      ) : (
        <button
          aria-label="Apply link"
          data-re-btn-bm-apply=""
          onMouseDown={(e) => e.stopPropagation()}
          type="submit"
        >
          <CheckIcon />
        </button>
      )}
    </form>
  );
}
