import { createSignal } from "solid-js";

const [context, setContext] = createSignal<Record<string, string>>({});

export function setWidgetContext(next: Record<string, string>): void {
  setContext({ ...next });
}

export function getWidgetContext(): Record<string, string> {
  return context();
}
