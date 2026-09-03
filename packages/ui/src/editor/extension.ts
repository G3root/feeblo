import { defineBasicExtension } from "prosekit/basic";
import { union } from "prosekit/core";
import {
  defineCodeBlock,
  defineCodeBlockHighlight,
} from "prosekit/extensions/code-block";
import { defineHorizontalRule } from "prosekit/extensions/horizontal-rule";
import { defineImageUploadHandler } from "prosekit/extensions/image";
import { defineMention } from "prosekit/extensions/mention";
import { definePlaceholder } from "prosekit/extensions/placeholder";
import { defineReadonly } from "prosekit/extensions/readonly";

import { createRangiParser } from "./highlight/rangi.js";
import { defineCodeBlockView } from "./ui/code-block-view/index.js";
import { defineImageView } from "./ui/image-view/index.js";
import { createEditorUploader } from "./uploader";

// The placeholder text applied when the Editor is used without an explicit
// placeholder prop. Kept here as the single source of truth for the default.
export const DEFAULT_PLACEHOLDER = "Press / for commands...";

export function defineExtension({
  deferUploads = false,
  editorScope,
  organizationId,
  readonly = false,
  placeholder,
}: {
  deferUploads?: boolean | undefined;
  editorScope?: string | undefined;
  organizationId?: string | undefined;
  readonly?: boolean | undefined;
  // Optional so callers can leave the placeholder out entirely (the Editor
  // applies the placeholder plugin dynamically; passing it here would create
  // a second plugin with the same key later).
  placeholder?: string | undefined;
} = {}) {
  const extensions = [
    defineBasicExtension(),
    defineMention(),
    // defineMath({
    //   renderMathBlock: renderKaTeXMathBlock,
    //   renderMathInline: renderKaTeXMathInline,
    // }),
    defineCodeBlock(),
    defineCodeBlockHighlight({ parser: createRangiParser() }),
    defineHorizontalRule(),
    defineCodeBlockView(),
    defineImageView(),
    defineImageUploadHandler({
      uploader: createEditorUploader(
        organizationId
          ? {
              deferUploads,
              organizationId,
              ...(editorScope && { scope: editorScope }),
            }
          : { deferUploads, ...(editorScope && { scope: editorScope }) }
      ),
    }),
  ];

  if (placeholder !== undefined) {
    extensions.push(definePlaceholder({ placeholder }));
  }

  if (readonly) {
    extensions.push(defineReadonly());
  }

  return union(extensions);
}

export type EditorExtension = ReturnType<typeof defineExtension>;
