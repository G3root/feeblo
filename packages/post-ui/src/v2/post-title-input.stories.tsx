import "../../tailwind.css";
import { useState } from "react";
import { PostTitleInput } from "./post-title-input";

export default {
  title: "V2 / PostTitleInput",
};

export function Default() {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostTitleInput
          name="title"
          onChange={(e) => setValue(e.target.value)}
          placeholder="Post title..."
          value={value}
        />
      </div>
    </div>
  );
}

export function Small() {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostTitleInput
          name="title"
          onChange={(e) => setValue(e.target.value)}
          placeholder="Post title..."
          size="sm"
          value={value}
        />
      </div>
    </div>
  );
}

export function Prefilled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostTitleInput
          defaultValue="My Awesome Feature Request"
          name="title"
          placeholder="Post title..."
        />
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <PostTitleInput
          defaultValue="Cannot edit this title"
          disabled
          name="title"
          placeholder="Post title..."
        />
      </div>
    </div>
  );
}
