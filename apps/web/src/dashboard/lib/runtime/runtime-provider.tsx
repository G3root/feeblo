import { ManagedRuntime } from "effect";
import { useEffect, useRef } from "react";
import { LiveLayer, type LiveManagedRuntime } from "./live-layer";
import { RuntimeContext } from "./runtime-context";

export const RuntimeProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const runtimeRef = useRef<LiveManagedRuntime | null>(null);

  if (!runtimeRef.current) {
    runtimeRef.current = ManagedRuntime.make(LiveLayer);
  }

  useEffect(() => {
    return () => {
      if (runtimeRef.current) {
        runtimeRef.current.dispose();
      }
    };
  }, []);

  return (
    <RuntimeContext.Provider value={runtimeRef.current}>
      {children}
    </RuntimeContext.Provider>
  );
};
