import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, type ReactNode, use } from "react";

type UpvoteToggleState = {
  disabled: boolean;
  isUpvoted: boolean;
  upvoteCount: number;
};

type UpvoteToggleActions = {
  onToggle: () => void | Promise<void>;
};

type UpvoteToggleMeta = {
  label: string;
};

type UpvoteToggleContextValue = {
  actions: UpvoteToggleActions;
  meta: UpvoteToggleMeta;
  state: UpvoteToggleState;
};

const UpvoteToggleContext = createContext<UpvoteToggleContextValue | null>(
  null
);

function useUpvoteToggle() {
  const value = use(UpvoteToggleContext);

  if (!value) {
    throw new Error("UpvoteToggle components must be used within Provider.");
  }

  return value;
}

type UpvoteToggleProviderProps = {
  children?: ReactNode;
  disabled?: boolean;
  isUpvoted: boolean;
  label?: string;
  onToggle: () => void | Promise<void>;
  upvoteCount: number;
};

type UpvoteToggleRootProps = UpvoteToggleProviderProps & {
  variant?: "compact" | "default";
};

function UpvoteToggleProvider({
  children,
  disabled = false,
  isUpvoted,
  label = "Upvote",
  onToggle,
  upvoteCount,
}: UpvoteToggleProviderProps) {
  return (
    <UpvoteToggleContext
      value={{
        actions: { onToggle },
        meta: { label },
        state: { disabled, isUpvoted, upvoteCount },
      }}
    >
      {children}
    </UpvoteToggleContext>
  );
}

type UpvoteToggleTriggerProps = {
  variant?: "compact" | "default";
};

function UpvoteToggleTrigger({
  variant = "default",
}: UpvoteToggleTriggerProps) {
  const { actions, meta, state } = useUpvoteToggle();

  const handleToggle = () => {
    if (state.disabled) {
      return;
    }
    actions.onToggle();
  };

  if (variant === "compact") {
    return (
      <button
        aria-label={meta.label}
        className={cn(
          "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
          state.isUpvoted
            ? "bg-primary/10 text-primary"
            : "bg-muted/70 text-muted-foreground hover:bg-muted"
        )}
        disabled={state.disabled}
        onClick={handleToggle}
        type="button"
      >
        <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
        <span className="font-medium text-xs tabular-nums leading-none">
          {state.upvoteCount}
        </span>
      </button>
    );
  }

  return (
    <Button
      aria-label={meta.label}
      className="rounded-full"
      disabled={state.disabled}
      onClick={handleToggle}
      size="sm"
      type="button"
      variant={state.isUpvoted ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      <span>{state.upvoteCount}</span>
    </Button>
  );
}

function UpvoteToggleComponent({
  variant = "default",
  ...providerProps
}: UpvoteToggleRootProps) {
  return (
    <UpvoteToggleProvider {...providerProps}>
      <UpvoteToggleTrigger variant={variant} />
    </UpvoteToggleProvider>
  );
}

export const UpvoteToggle = Object.assign(UpvoteToggleComponent, {
  Provider: UpvoteToggleProvider,
  Trigger: UpvoteToggleTrigger,
});
