import { computePosition, flip, shift } from "@floating-ui/dom";
import {
  CodeSimpleIcon,
  Heading01Icon,
  Heading02Icon,
  Heading03Icon,
  Image01Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  ParagraphIcon,
  QuoteDownIcon,
  TableIcon,
} from "@hugeicons/core-free-icons";
import type { Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions as TiptapSuggestionOptions } from "@tiptap/suggestion";
import CommandsList, {
  type CommandsListHandle,
  type SlashItem,
} from "./commands-list";

export type ImagePickerUrlResult = {
  kind: "url";
  src: string;
  alt?: string;
  title?: string;
};

export type ImagePickerFileResult = {
  kind: "file";
  file: File;
  alt?: string;
  title?: string;
};

export type ImagePickerResult = ImagePickerUrlResult | ImagePickerFileResult;

export type ImagePickerContext = {
  editor: Editor;
  range: { from: number; to: number };
};

export type ImagePickerHandler = (
  context: ImagePickerContext
) => ImagePickerResult | null | Promise<ImagePickerResult | null>;

export type SlashImageFallback = "prompt-url" | "none";

type SuggestionOptions = {
  onRequestImage?: ImagePickerHandler | null;
  onInsertLocalImageFile?:
    | ((
        context: ImagePickerContext & Omit<ImagePickerFileResult, "kind">
      ) => void | Promise<void>)
    | null;
  enableImages?: boolean;
  imageSlashFallback?: SlashImageFallback;
};

type RequestImageAndInsertArgs = ImagePickerContext & {
  onRequestImage: ImagePickerHandler | null;
  onInsertLocalImageFile:
    | ((
        context: ImagePickerContext & Omit<ImagePickerFileResult, "kind">
      ) => void | Promise<void>)
    | null;
  imageSlashFallback: SlashImageFallback;
};

const requestImageAndInsert = async ({
  editor,
  range,
  onRequestImage,
  onInsertLocalImageFile,
  imageSlashFallback = "prompt-url",
}: RequestImageAndInsertArgs): Promise<void> => {
  let result: ImagePickerResult | null = null;
  if (onRequestImage) {
    result = await onRequestImage({ editor, range });
  } else if (imageSlashFallback === "prompt-url") {
    const src = window.prompt("Image URL")?.trim();
    result = src ? { kind: "url", src } : null;
  }

  if (!result) {
    return;
  }

  if (result.kind === "file") {
    if (!onInsertLocalImageFile) {
      return;
    }
    editor.chain().focus().deleteRange(range).run();
    const fileInsertContext: ImagePickerContext &
      Omit<ImagePickerFileResult, "kind"> = {
      editor,
      range,
      file: result.file,
      ...(result.alt ? { alt: result.alt } : {}),
      ...(result.title ? { title: result.title } : {}),
    };
    await onInsertLocalImageFile(fileInsertContext);
    return;
  }

  const imageAttrs = {
    src: result.src,
    ...(result.alt ? { alt: result.alt } : {}),
    ...(result.title ? { title: result.title } : {}),
  };

  editor.chain().focus().deleteRange(range).setImage(imageAttrs).run();
};

const getAllItems = (options: SuggestionOptions): SlashItem[] => [
  {
    title: "Text",
    icon: ParagraphIcon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    icon: Heading01Icon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    icon: Heading02Icon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: Heading03Icon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    icon: LeftToRightListBulletIcon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    icon: LeftToRightListNumberIcon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Image",
    icon: Image01Icon,
    command: ({ editor, range }) => {
      requestImageAndInsert({
        editor,
        range,
        onRequestImage: options.onRequestImage ?? null,
        onInsertLocalImageFile: options.onInsertLocalImageFile ?? null,
        imageSlashFallback: options.imageSlashFallback ?? "prompt-url",
      });
    },
  },
  {
    title: "Table",
    icon: TableIcon,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    title: "Quote",
    icon: QuoteDownIcon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    icon: CodeSimpleIcon,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

type SlashSuggestion = Pick<TiptapSuggestionOptions, "items" | "render">;
type SuggestionRenderLifecycle = NonNullable<
  ReturnType<NonNullable<SlashSuggestion["render"]>>
>;
type SuggestionKeyDownProps = Parameters<
  NonNullable<SuggestionRenderLifecycle["onKeyDown"]>
>[0];

const updatePosition = (
  element: HTMLElement,
  clientRect: () => DOMRect
): void => {
  const virtualElement = { getBoundingClientRect: clientRect };
  computePosition(virtualElement, element, {
    placement: "bottom-start",
    strategy: "absolute",
    middleware: [shift(), flip()],
  }).then(({ x, y, strategy }) => {
    element.style.position = strategy;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  });
};

const createSuggestion = (
  options: SuggestionOptions = {}
): SlashSuggestion => ({
  items: ({ query }: { query: string }) =>
    getAllItems(options)
      .filter(
        (item) => options.enableImages !== false || item.title !== "Image"
      )
      .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 10),

  render: (): SuggestionRenderLifecycle => {
    let component: ReactRenderer<CommandsListHandle> | null = null;

    return {
      onStart: (props) => {
        component = new ReactRenderer(CommandsList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) {
          return;
        }

        const el = component.element;
        el.style.width = "max-content";
        el.style.zIndex = "90";
        document.body.appendChild(el);

        const clientRect = () =>
          props.clientRect?.() ?? new DOMRect(0, 0, 0, 0);
        updatePosition(el, clientRect);
      },

      onUpdate: (props) => {
        if (!component) {
          return;
        }
        component.updateProps(props);

        if (!props.clientRect) {
          return;
        }

        const clientRect = () =>
          props.clientRect?.() ?? new DOMRect(0, 0, 0, 0);
        updatePosition(component.element, clientRect);
      },

      onKeyDown: ({ event }: SuggestionKeyDownProps): boolean => {
        if (event.key === "Escape") {
          component?.element.remove();
          return true;
        }

        return component?.ref?.onKeyDown(event) ?? false;
      },

      onExit: (): void => {
        component?.element.remove();
        component?.destroy();
      },
    };
  },
});

export default createSuggestion;
