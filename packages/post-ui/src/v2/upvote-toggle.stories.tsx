import "../../tailwind.css";
import { useState } from "react";
import { UpvoteToggle } from "./upvote-toggle";

export default {
  title: "V2 / UpvoteToggle",
};

export function Default() {
  const [isUpvoted, setIsUpvoted] = useState(false);
  const [count, setCount] = useState(42);

  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-8">
      <UpvoteToggle
        isUpvoted={isUpvoted}
        onToggle={() => {
          setIsUpvoted((prev) => !prev);
          setCount((c) => (isUpvoted ? c - 1 : c + 1));
        }}
        upvoteCount={count}
      />
    </div>
  );
}

export function Compact() {
  const [isUpvoted, setIsUpvoted] = useState(false);
  const [count, setCount] = useState(42);

  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-8">
      <UpvoteToggle
        isUpvoted={isUpvoted}
        onToggle={() => {
          setIsUpvoted((prev) => !prev);
          setCount((c) => (isUpvoted ? c - 1 : c + 1));
        }}
        upvoteCount={count}
        variant="compact"
      />
    </div>
  );
}

export function Active() {
  const [count, setCount] = useState(42);

  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-8">
      <UpvoteToggle
        isUpvoted
        onToggle={() => setCount((c) => c + 1)}
        upvoteCount={count}
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-8">
      <UpvoteToggle
        disabled
        isUpvoted={false}
        onToggle={() => {}}
        upvoteCount={42}
      />
      <UpvoteToggle
        disabled
        isUpvoted
        onToggle={() => {}}
        upvoteCount={42}
      />
    </div>
  );
}

export function Composed() {
  const [isUpvoted, setIsUpvoted] = useState(false);
  const [count, setCount] = useState(42);

  return (
    <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-8">
      <UpvoteToggle.Provider
        isUpvoted={isUpvoted}
        label="Upvote this post"
        onToggle={() => {
          setIsUpvoted((prev) => !prev);
          setCount((c) => (isUpvoted ? c - 1 : c + 1));
        }}
        upvoteCount={count}
      >
        <UpvoteToggle.Trigger />
      </UpvoteToggle.Provider>
      <UpvoteToggle.Provider
        isUpvoted={isUpvoted}
        label="Upvote this post"
        onToggle={() => {
          setIsUpvoted((prev) => !prev);
          setCount((c) => (isUpvoted ? c - 1 : c + 1));
        }}
        upvoteCount={count}
      >
        <UpvoteToggle.Trigger variant="compact" />
      </UpvoteToggle.Provider>
    </div>
  );
}
