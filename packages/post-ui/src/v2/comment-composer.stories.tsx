import "../../tailwind.css";
import { useState } from "react";
import { CommentComposer } from "./comment-composer";

export default {
  title: "V2 / CommentComposer",
};

export function Default() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer
          onSubmit={async ({ content, isPrivate }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({
              content,
              isPrivate: isPrivate ? "Internal" : "Public",
            });
          }}
        />
      </div>
    </div>
  );
}

export function PrivateDefault() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer
          isPrivate
          onSubmit={async ({ content, isPrivate }) => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({
              content,
              isPrivate: isPrivate ? "Internal" : "Public",
            });
          }}
        />
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer disabled onSubmit={async () => {}} />
      </div>
    </div>
  );
}

export function CustomLabels() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer
          onSubmit={async ({ content, isPrivate }) => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({
              content,
              isPrivate: isPrivate ? "Team Only" : "Everyone",
            });
          }}
          placeholder="Share your thoughts..."
          privateLabel="Team Only"
          publicLabel="Everyone"
        />
      </div>
    </div>
  );
}

export function ControlledState() {
  const [content, setContent] = useState("Pre-filled content...");
  const [isPrivate, setIsPrivate] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer
          content={content}
          isPrivate={isPrivate}
          onContentChange={(c) => setContent(c)}
          onSubmit={async ({
            content: submittedContent,
            isPrivate: submittedIsPrivate,
          }) => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log({
              content: submittedContent,
              isPrivate: submittedIsPrivate ? "Internal" : "Public",
            });
          }}
          onVisibilityChange={(checked) => setIsPrivate(checked)}
        />
      </div>
    </div>
  );
}

export function Composed() {
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // biome-ignore lint/suspicious/noConsole: story demo
    console.log({
      content,
      isPrivate: isPrivate ? "Internal" : "Public",
    });
    setResetKey((k) => k + 1);
    setContent("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentComposer.Provider
          content={content}
          isPrivate={isPrivate}
          onContentChange={(c) => setContent(c)}
          onSubmit={handleSubmit}
          onVisibilityChange={(checked) => setIsPrivate(checked)}
          resetKey={resetKey}
        >
          <div className="rounded-md border p-3">
            <CommentComposer.Editor />
            <CommentComposer.Submit />
          </div>
        </CommentComposer.Provider>
      </div>
    </div>
  );
}
