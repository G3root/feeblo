/** biome-ignore-all lint/complexity/noVoid: <explanation> */
// credit https://github.com/resend/react-email/blob/canary/packages/editor/src/plugins/image/extension.tsx

import { Node } from "@tiptap/core";
import { createImageFileHandlerPlugin } from "./file-handler";
import type { UseEditorImageOptions } from "./types";
import { executeUploadFlow } from "./upload-flow";

export function createImageExtension(options: UseEditorImageOptions) {
  return Node.create({
    name: "image",
    group: "block",
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        src: { default: "" },
        alt: { default: "" },
        width: { default: "auto" },
        height: { default: "auto" },
        alignment: { default: "center" },
        href: { default: null },
      };
    },

    parseHTML() {
      return [{ tag: "img[src]" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["img", HTMLAttributes];
    },

    addCommands() {
      return {
        setImage:
          (attrs) =>
          ({ commands }) => {
            return commands.insertContent({
              type: this.name,
              attrs,
            });
          },

        uploadImage:
          () =>
          ({ editor }) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = () => {
              const file = input.files?.[0];
              if (file) {
                void executeUploadFlow({
                  editor,
                  file,
                  uploadImage: options.uploadImage,
                });
              }
            };
            input.click();
            return true;
          },
      };
    },

    addProseMirrorPlugins() {
      const { editor } = this;

      return [createImageFileHandlerPlugin(editor, options.uploadImage)];
    },
  });
}
