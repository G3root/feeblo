import { useEffect, useRef } from "react";

/**
 * Calls `f` when the window is scrolled near the bottom of the page, then
 * re-fires on the next bottom-touch whenever the page grows (new rows were
 * appended), driving infinite loading. Mirrors the reference search app's
 * `useScrollBottom` that advances its pull atom.
 */
export function useScrollBottom(f: () => void): void {
  const fRef = useRef(f);
  const bottomRef = useRef(false);

  // Keep the callback fresh inside an effect rather than during render, so
  // concurrent rendering never observes a half-updated ref; the stable scroll
  // listener always invokes whatever `f` is current via the ref.
  useEffect(() => {
    fRef.current = f;
  });

  useEffect(() => {
    let scrollHeight = readScrollHeight();
    let frame: number | null = null;

    const check = () => {
      frame = null;
      const scrolledTo = window.scrollY + window.innerHeight;
      const threshold = window.innerHeight;

      const newScrollHeight = readScrollHeight();
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

    // Run once immediately after mounting: content shorter than the viewport
    // never fires a scroll event, but still needs to trigger `f`.
    check();

    // Coalesce scroll events into a single measurement per animation frame
    // instead of reading layout synchronously on every event.
    const onscroll = () => {
      if (frame === null) {
        frame = requestAnimationFrame(check);
      }
    };

    window.addEventListener("scroll", onscroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onscroll);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
}

const readScrollHeight = () =>
  document.documentElement.scrollHeight || document.body.scrollHeight;
