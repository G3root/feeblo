import type { EditorProps } from "@feeblo/ui/editor";
import { EditorProvider } from "@feeblo/ui/editor/editor-store";
import { lazy, Suspense } from "react";

const Editor = lazy(() =>
  import("@feeblo/ui/editor").then((mod) => ({ default: mod.Editor }))
);

interface PostContentEditorProps extends EditorProps {
  onChange: (value: string) => void;
  value: string;
}

export function PostContentEditor({
  onChange,
  value,
  readOnly,
  ...rest
}: PostContentEditorProps) {
  return (
    <div className="space-y-3">
      <Suspense>
        <EditorProvider defaultValue={{ postContent: value }}>
          <Editor
            onChange={(doc) => {
              onChange(doc);
            }}
            placeholder="Add description..."
            readOnly={readOnly}
            {...rest}
          />
        </EditorProvider>
      </Suspense>

      {
        //TODO: Add image upload button when editor is not readOnly
        readOnly ? null : null
        // <div className="flex justify-end">
        //   <Button
        //     className="rounded-full"
        //     onClick={() => {
        //       editorRef.current?.editor?.commands.focus();
        //       (
        //         editorRef.current?.editor?.commands as {
        //           uploadImage?: () => boolean;
        //         }
        //       )?.uploadImage?.();
        //     }}
        //     size="sm"
        //     type="button"
        //     variant="outline"
        //   >
        //     <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
        //     <span>Add image</span>
        //   </Button>
        // </div>
      }
    </div>
  );
}
