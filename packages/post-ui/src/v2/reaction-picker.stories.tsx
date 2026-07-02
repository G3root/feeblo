import "../../tailwind.css";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { useState } from "react";
import { ReactionPicker } from "./reaction-picker";

export default {
  title: "V2 / ReactionPicker",
};

export function Default() {
  const [selected, setSelected] = useState<ReactionEmoji | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        isSelected={(emoji) => selected === emoji}
        onSelect={(emoji) => setSelected(selected === emoji ? null : emoji)}
      />
    </div>
  );
}

export function Small() {
  const [selected, setSelected] = useState<ReactionEmoji | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        isSelected={(emoji) => selected === emoji}
        onSelect={(emoji) => setSelected(selected === emoji ? null : emoji)}
        size="sm"
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker disabled isSelected={() => false} onSelect={() => {}} />
    </div>
  );
}

export function Preselected() {
  const [selected, setSelected] = useState<ReactionEmoji>("red_heart");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <ReactionPicker
        isSelected={(emoji) => selected === emoji}
        onSelect={(emoji) => setSelected(selected === emoji ? null : emoji)}
      />
    </div>
  );
}
