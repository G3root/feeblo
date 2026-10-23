import * as React from "react";

/**
 * The one fixed slot at the bottom of the dashboard on phones.
 *
 * The bottom nav and a contextual bar (today the board's bulk-selection
 * actions) both want to be fixed, centered and thumb-reachable, so rendering
 * both stacks two pills over the content and puts a destructive Delete button
 * directly above the nav icons. The slot instead lets a surface claim the
 * position: the nav fades out while a selection exists, the selection bar sits
 * exactly where the nav sat, and the nav comes back when the selection clears.
 *
 * Occupancy is a single boolean rather than a registry because only one
 * contextual bar can own the slot; a second claimant would be a layout bug,
 * not a feature.
 */
type MobileBottomSlotValue = {
  occupied: boolean;
  setOccupied: React.Dispatch<React.SetStateAction<boolean>>;
};

const MobileBottomSlotContext =
  React.createContext<MobileBottomSlotValue | null>(null);

export function MobileBottomSlotProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [occupied, setOccupied] = React.useState(false);
  const value = React.useMemo(() => ({ occupied, setOccupied }), [occupied]);

  return (
    <MobileBottomSlotContext.Provider value={value}>
      {children}
    </MobileBottomSlotContext.Provider>
  );
}

function useMobileBottomSlot(): MobileBottomSlotValue {
  const value = React.useContext(MobileBottomSlotContext);

  if (!value) {
    throw new Error(
      "MobileBottomSlot hooks must be used within MobileBottomSlotProvider"
    );
  }

  return value;
}

export function useMobileBottomSlotOccupied(): boolean {
  return useMobileBottomSlot().occupied;
}

/**
 * Claims the slot while `occupied` is true and releases it on unmount, so a
 * surface that disappears mid-selection (filters, route change) cannot leave
 * the nav hidden.
 */
export function useOccupyMobileBottomSlot(occupied: boolean): void {
  const { setOccupied } = useMobileBottomSlot();

  React.useEffect(() => {
    if (!occupied) {
      return;
    }

    setOccupied(true);
    return () => setOccupied(false);
  }, [occupied, setOccupied]);
}
