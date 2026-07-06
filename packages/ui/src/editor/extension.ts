import { defineBasicExtension } from "prosekit/basic";
import { union } from "prosekit/core";
import {
  defineCodeBlock,
  defineCodeBlockShiki,
} from "prosekit/extensions/code-block";
import { defineHorizontalRule } from "prosekit/extensions/horizontal-rule";
import { defineImageUploadHandler } from "prosekit/extensions/image";
import { defineMention } from "prosekit/extensions/mention";
import { definePlaceholder } from "prosekit/extensions/placeholder";
import { defineReadonly } from "prosekit/extensions/readonly";
import { sampleUploader } from "./sample/sample-uploader.js";
import { defineCodeBlockView } from "./ui/code-block-view/index.js";
import { defineImageView } from "./ui/image-view/index.js";

export function defineExtension({
  readonly = false,
  placeholder = "Press / for commands...",
} = {}) {
  const extensions = [
    defineBasicExtension(),
    definePlaceholder({ placeholder }),
    defineMention(),
    // defineMath({
    //   renderMathBlock: renderKaTeXMathBlock,
    //   renderMathInline: renderKaTeXMathInline,
    // }),
    defineCodeBlock(),
    defineCodeBlockShiki(),
    defineHorizontalRule(),
    defineCodeBlockView(),
    defineImageView(),
    defineImageUploadHandler({
      uploader: sampleUploader,
    }),
  ];

  if (readonly) {
    extensions.push(defineReadonly());
  }

  return union(extensions);
}

export type EditorExtension = ReturnType<typeof defineExtension>;
