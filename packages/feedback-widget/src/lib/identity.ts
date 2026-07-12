import { createSignal } from "solid-js";

export interface WidgetIdentity {
  avatar?: string | undefined;
  companies?:
    | Array<{
        id: string;
        name: string;
        avatar?: string | undefined;
        customFields?: Record<string, unknown> | undefined;
      }>
    | undefined;
  customFields?: Record<string, unknown> | undefined;
  email?: string | undefined;
  id: string;
  name?: string | undefined;
  token: string;
}

const [identity, setIdentity] = createSignal<WidgetIdentity | null>(null);

export function getWidgetIdentity(): WidgetIdentity | null {
  return identity();
}

export function getWidgetToken(): string | null {
  return identity()?.token ?? null;
}

export function setWidgetIdentity(data: WidgetIdentity): void {
  setIdentity(data);
}

export function clearWidgetIdentity(): void {
  setIdentity(null);
}
