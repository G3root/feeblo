import "../../tailwind.css";
import { useState } from "react";
import { PostEditor } from "./post-editor";

export default {
  title: "V2 / PostEditor",
};

export function Default() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor
          onSubmit={async ({ content }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({ content });
          }}
        />
      </div>
    </div>
  );
}

export function WithSubmit() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor
          onSubmit={async ({ content }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({ content });
          }}
        >
          <PostEditor.Submit />
        </PostEditor>
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor disabled onSubmit={async () => {}}>
          <PostEditor.Submit />
        </PostEditor>
      </div>
    </div>
  );
}

export function ControlledState() {
  const [content, setContent] = useState("Pre-filled **rich text** content");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor
          content={content}
          onContentChange={(c) => setContent(c)}
          onSubmit={async ({ content: submittedContent }) => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({ content: submittedContent });
          }}
        >
          <PostEditor.Submit />
        </PostEditor>
      </div>
    </div>
  );
}

export function Composed() {
  const [content, setContent] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // biome-ignore lint/suspicious/noConsole: story demo
    console.log({ content });
    setResetKey((k) => k + 1);
    setContent("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor.Provider
          content={content}
          onContentChange={(c) => setContent(c)}
          onSubmit={handleSubmit}
          resetKey={resetKey}
        >
          <div className="p-3">
            <PostEditor.Editor />
            <PostEditor.Submit />
          </div>
        </PostEditor.Provider>
      </div>
    </div>
  );
}

export function CustomLabels() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostEditor
          onSubmit={async ({ content }) => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({ content });
          }}
          placeholder="What's on your mind?"
          submitLabel="Create Post"
        >
          <PostEditor.Submit />
        </PostEditor>
      </div>
    </div>
  );
}
