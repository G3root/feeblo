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
        onToggle={(emoji) => {
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
        onToggle={() => {}}
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
        onToggle={(emoji) => {
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

const SAMPLE_REACTION_LIST = new Map<ReactionEmoji, { count: number }>([
  ["red_heart", { count: 12 }],
  ["party_popper", { count: 5 }],
  ["thumbs_down", { count: 3 }],
]);

export function Composed() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker.Provider
        existingReactions={selected}
        label="React to this post"
        onToggle={(emoji) => {
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
        reactionList={SAMPLE_REACTION_LIST}
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
        onToggle={(emoji) => {
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
        reactionList={SAMPLE_REACTION_LIST}
      >
        <ReactionPicker.displayRow />
      </ReactionPicker.Provider>
    </div>
  );
}
