import { useEffect, useState } from "react";

/**
 * Tracks vertical scroll direction and whether the page has scrolled
 * past a threshold. Used to build hide-on-scroll-down / show-on-scroll-up
 * headers with a compact shrunk state after leaving the very top.
 */
export function useScrollDirection(threshold = 12) {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      setScrolled(y > 8);
      if (Math.abs(delta) > threshold) {
        // Never hide while near top; never hide when at absolute top.
        setHidden(delta > 0 && y > 96);
        lastY = y;
      }
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return { hidden, scrolled };
}
