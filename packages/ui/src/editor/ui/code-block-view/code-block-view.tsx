// import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import {
  type CodeBlockAttrs,
  isCodeBlockPreviewHiddenDecoration,
} from "prosekit/extensions/code-block";
import type { ReactNodeViewProps } from "prosekit/react";
import { useRef } from "react";

import { codeBlockLanguages } from "../../highlight/languages.js";

export default function CodeBlockView(props: ReactNodeViewProps) {
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const attrs = props.node.attrs as CodeBlockAttrs;
  const language = attrs.language || "";
  const hidePreview = props.decorations.some(
    isCodeBlockPreviewHiddenDecoration
  );
  const preRef = useRef<HTMLElement | null>(null);

  const showMermaidPreview = !hidePreview && language === "mermaid";

  const setLanguage = (language: string) => {
    const attrs: CodeBlockAttrs = { language };
    props.setAttrs(attrs);
  };

  // const focusSource = (event: React.MouseEvent | React.KeyboardEvent) => {
  //   event.preventDefault();
  //   const pos = props.getPos();
  //   if (typeof pos !== "number") {
  //     return;
  //   }
  //   const { state, dispatch } = props.view;
  //   const selection = TextSelection.near(state.doc.resolve(pos + 1), 1);
  //   dispatch(state.tr.setSelection(selection));
  //   props.view.focus();
  //   preRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // };

  // const code = props.node.textContent;

  // const mermaidPreview = useMemo(() => {
  //   if (language !== "mermaid") {
  //     return { svg: null, error: null };
  //   }
  //   try {
  //     return {
  //       svg: renderMermaidSVG(code, THEMES["tokyo-night"]),
  //       error: null,
  //     };
  //   } catch (err) {
  //     return {
  //       svg: null,
  //       error: err instanceof Error ? err : new Error(String(err)),
  //     };
  //   }
  // }, [code, language]);

  return (
    <>
      <div
        className="relative top-3 mx-2 h-0 overflow-visible text-xs select-none data-preview:hidden"
        contentEditable={false}
        // data-preview={showMermaidPreview ? "" : undefined}
      >
        <select
          aria-label="Code block language"
          className="text-muted-foreground outline-unset focus:outline-unset relative box-border w-auto cursor-pointer appearance-none rounded-sm border-none bg-transparent px-2 py-1 text-xs opacity-0 transition select-none hover:opacity-80 [div[data-node-view-root]:hover_&]:opacity-50 hover:[div[data-node-view-root]:hover_&]:opacity-80"
          onChange={(event) => setLanguage(event.target.value)}
          value={language}
        >
          <option value="">Plain Text</option>
          {codeBlockLanguages.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <pre
        className="data-preview:hidden"
        data-language={language}
        data-preview={showMermaidPreview ? "" : undefined}
        ref={(element) => {
          props.contentRef(element);
          preRef.current = element;
        }}
      />
      {/* {showMermaidPreview && (
        <div
          aria-label="Edit source"
          className="block overflow-auto py-2"
          contentEditable={false}
          onMouseDown={focusSource}
        >
          {mermaidPreview.error ? (
            <pre>{mermaidPreview.error.message}</pre>
          ) : null}
          {mermaidPreview.svg ? (
            <div dangerouslySetInnerHTML={{ __html: mermaidPreview.svg }} />
          ) : null}
        </div>
      )} */}
    </>
  );
}
