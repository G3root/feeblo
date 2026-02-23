import type { ManagedRuntime } from "effect";
import React from "react";
import type { LiveManagedRuntime } from "./live-layer";

export type RuntimeContext =
  ManagedRuntime.ManagedRuntime.Context<LiveManagedRuntime>;
export const RuntimeContext = React.createContext<LiveManagedRuntime | null>(
  null
);
