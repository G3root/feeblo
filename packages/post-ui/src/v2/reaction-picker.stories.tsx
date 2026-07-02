import "../../tailwind.css";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { useState } from "react";
import { ReactionPicker } from "./reaction-picker";

export default {
  title: "V2 / ReactionPicker",
};

export function Default() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        existingReactions={selected}
        onSelect={(emoji) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(emoji)) {
              next.delete(emoji);
            } else {
              next.add(emoji);
            }
            return next;
          });
        }}
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        disabled
        existingReactions={new Set()}
        onSelect={() => {}}
      />
    </div>
  );
}

export function Preselected() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(
    new Set(["red_heart"])
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        existingReactions={selected}
        onSelect={(emoji) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(emoji)) {
              next.delete(emoji);
            } else {
              next.add(emoji);
            }
            return next;
          });
        }}
      />
    </div>
  );
}

export function Composed() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker.Provider
        existingReactions={selected}
        label="React to this post"
        onSelect={(emoji) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(emoji)) {
              next.delete(emoji);
            } else {
              next.add(emoji);
            }
            return next;
          });
        }}
      >
        <ReactionPicker.Trigger />
        <ReactionPicker.Grid />
      </ReactionPicker.Provider>
    </div>
  );
}

export function InlineDisplay() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker.Provider
        existingReactions={selected}
        onSelect={(emoji) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(emoji)) {
              next.delete(emoji);
            } else {
              next.add(emoji);
            }
            return next;
          });
        }}
      >
        <ReactionPicker.displayRow />
      </ReactionPicker.Provider>
    </div>
  );
}
