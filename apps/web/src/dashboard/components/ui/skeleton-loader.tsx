import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import { cn } from "~/lib/utils";

export const SkeletonContext = createContext<boolean | null>(null);

export type SkeletonElement = ReactElement<{
  className?: string;
  tabIndex?: number;
  "aria-hidden"?: boolean;
  inert?: boolean | "true";
  "data-inline-skeleton"?: boolean;
}>;

export function useIsSkeleton(): boolean | null {
  return useContext(SkeletonContext);
}

export interface SkeletonProps {
  children: ReactNode;
  isLoading: boolean;
}

export function SkeletonLoader({
  children,
  isLoading,
}: SkeletonProps): ReactNode {
  return (
    <SkeletonContext.Provider value={isLoading}>
      {children}
    </SkeletonContext.Provider>
  );
}

// Clones the child element and displays it with skeleton styling.
export function SkeletonWrapper({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const isLoading = useContext(SkeletonContext);

  if (isLoading == null || !isLoading) {
    return children;
  }

  const commonProps = {
    "aria-hidden": true,
    inert: true,
    tabIndex: -1,
    className: "skeleton-loader",
  };

  return (
    <SkeletonContext.Provider value={null}>
      {isValidElement<SkeletonElement["props"]>(children) ? (
        cloneElement(children, {
          ...commonProps,
          className: cn(commonProps.className, children.props.className),
        })
      ) : (
        <span {...commonProps} data-inline-skeleton>
          {children}
        </span>
      )}
    </SkeletonContext.Provider>
  );
}
