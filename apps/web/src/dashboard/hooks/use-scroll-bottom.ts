import { useEffect, useRef } from "react";

/**
 * Calls `f` when the window is scrolled near the bottom of the page, then
 * re-fires on the next bottom-touch whenever the page grows (new rows were
 * appended), driving infinite loading. Mirrors the reference search app's
 * `useScrollBottom` that advances its pull atom.
 */
export function useScrollBottom(f: () => void): void {
  const fRef = useRef(f);
  fRef.current = f;
  const bottomRef = useRef(false);

  useEffect(() => {
    let scrollHeight = document.body.scrollHeight;

    const onscroll = () => {
      const scrolledTo = window.scrollY + window.innerHeight;
      const threshold = window.innerHeight;

      const newScrollHeight = document.body.scrollHeight;
      const scrollHeightChanged = scrollHeight !== newScrollHeight;
      scrollHeight = newScrollHeight;

      const isReachBottom = newScrollHeight - threshold <= scrolledTo;

      if (isReachBottom && (!bottomRef.current || scrollHeightChanged)) {
        bottomRef.current = true;
        fRef.current();
      } else if (!isReachBottom) {
        bottomRef.current = false;
      }
    };

    window.addEventListener("scroll", onscroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onscroll);
    };
  }, []);
}
