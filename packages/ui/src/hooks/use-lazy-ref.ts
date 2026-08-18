import * as React from "react";

function useLazyRef<T>(fn: () => T) {
  const ref = React.useRef<T | null>(null);

  if (ref.current === null) {
    ref.current = fn();
  }

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return ref as React.RefObject<T>;
}

export { useLazyRef };
