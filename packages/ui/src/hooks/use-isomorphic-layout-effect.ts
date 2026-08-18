import { hasWindow } from "@feeblo/utils/runtime-kind";
import * as React from "react";

const useIsomorphicLayoutEffect =
  hasWindow() ? React.useLayoutEffect : React.useEffect;

export { useIsomorphicLayoutEffect };
