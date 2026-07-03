import { Editor, type EditorProps, EditorProvider } from "@feeblo/ui/editor";

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
