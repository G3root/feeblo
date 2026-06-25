import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import * as React from "react";
import { editorEventBus } from "../../core/event-bus";
import { CheckIcon, LinkIcon, UnlinkIcon } from "../icons";
import { useBubbleMenuContext } from "./context";
import { focusEditor, getUrlFromString, setLinkHref } from "./utils";

export interface BubbleMenuLinkSelectorProps {
  /** Plugin slot: extra actions rendered inside the link input form */
  children?: React.ReactNode;
  className?: string;
  /** Called after link is applied */
  onLinkApply?: (href: string) => void;
  /** Called after link is removed */
  onLinkRemove?: () => void;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state */
  open?: boolean;
  /** Whether to show the link icon toggle button (default: true) */
  showToggle?: boolean;
  /** Custom URL validator. Return the valid URL string or null. */
  validateUrl?: (value: string) => string | null;
}

export function BubbleMenuLinkSelector({
  className,
  showToggle = true,
  validateUrl,
  onLinkApply,
  onLinkRemove,
  children,
  open: controlledOpen,
  onOpenChange,
}: BubbleMenuLinkSelectorProps) {
  const { editor } = useBubbleMenuContext();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const setIsOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  const editorState = useEditorState({
    editor,
    selector: ({ editor }) => ({
      isLinkActive: editor?.isActive("link") ?? false,
      hasLink: Boolean(editor?.getAttributes("link").href),
      currentHref: (editor?.getAttributes("link").href as string) || "",
    }),
  });

  const setIsOpenRef = React.useRef(setIsOpen);
  setIsOpenRef.current = setIsOpen;

  React.useEffect(() => {
    const subscription = editorEventBus.on("bubble-menu:add-link", () => {
      setIsOpenRef.current(true);
    });

    return () => {
      setIsOpenRef.current(false);
      subscription.unsubscribe();
    };
  }, []);

  if (!editorState) {
    return null;
  }

  const handleOpenLink = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div
      data-re-link-selector=""
      {...(isOpen ? { "data-open": "" } : {})}
      {...(editorState.hasLink ? { "data-has-link": "" } : {})}
      className={className}
    >
      {showToggle && (
        <button
          aria-expanded={isOpen}
          aria-haspopup="true"
          aria-label="Add link"
          aria-pressed={editorState.isLinkActive && editorState.hasLink}
          data-re-link-selector-trigger=""
          onClick={handleOpenLink}
          type="button"
        >
          <LinkIcon />
        </button>
      )}
      {isOpen && (
        <LinkForm
          currentHref={editorState.currentHref}
          editor={editor}
          onLinkApply={onLinkApply}
          onLinkRemove={onLinkRemove}
          setIsOpen={setIsOpen}
          validateUrl={validateUrl}
        >
          {children}
        </LinkForm>
      )}
    </div>
  );
}

interface LinkFormProps {
  children?: React.ReactNode;
  currentHref: string;
  editor: Editor;
  onLinkApply?: (href: string) => void;
  onLinkRemove?: () => void;
  setIsOpen: (state: boolean) => void;
  validateUrl?: (value: string) => string | null;
}

function LinkForm({
  editor,
  currentHref,
  validateUrl,
  onLinkApply,
  onLinkRemove,
  setIsOpen,
  children,
}: LinkFormProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const displayHref = currentHref === "#" ? "" : currentHref;
  const [inputValue, setInputValue] = React.useState(displayHref);

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editor.getAttributes("link").href === "#") {
          editor.chain().unsetLink().run();
        }
        setIsOpen(false);
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
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [editor, setIsOpen]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const value = inputValue.trim();

    if (value === "") {
      setLinkHref(editor, "");
      setIsOpen(false);
      focusEditor(editor);
      onLinkRemove?.();
      return;
    }

    const validate = validateUrl ?? getUrlFromString;
    const finalValue = validate(value);

    if (!finalValue) {
      setLinkHref(editor, "");
      setIsOpen(false);
      focusEditor(editor);
      onLinkRemove?.();
      return;
    }

    setLinkHref(editor, finalValue);
    setIsOpen(false);
    focusEditor(editor);
    onLinkApply?.(finalValue);
  }

  function handleUnlink(e: React.MouseEvent) {
    e.stopPropagation();
    setLinkHref(editor, "");
    setIsOpen(false);
    focusEditor(editor);
    onLinkRemove?.();
  }

  return (
    <form
      data-re-link-selector-form=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <input
        data-re-link-selector-input=""
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={(e) => e.stopPropagation()}
        placeholder="Paste a link"
        ref={inputRef}
        type="text"
        value={inputValue}
      />

      {children}

      {displayHref ? (
        <button
          aria-label="Remove link"
          data-re-link-selector-unlink=""
          onClick={handleUnlink}
          type="button"
        >
          <UnlinkIcon />
        </button>
      ) : (
        <button
          aria-label="Apply link"
          data-re-link-selector-apply=""
          onMouseDown={(e) => e.stopPropagation()}
          type="submit"
        >
          <CheckIcon />
        </button>
      )}
    </form>
  );
}
