import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const SECTIONS = [
  { id: "hero", label: "Home" },
  { id: "features", label: "Features" },
  { id: "lounges", label: "Lounges" },
  
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
] as const;

// Make the section programmatically focusable without inserting it into the
// tab order, then focus it so keyboard/AT users are placed inside the section.
function focusSection(el: HTMLElement) {
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
  }
  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  el.focus({ preventScroll: !prefersReduced });
}

export function HomeScrollspyNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  // Timestamp until which passive persist + observer state changes are
  // suppressed after a click, so smooth scrolling doesn't flip active state.
  const suppressPersistUntilRef = useRef(0);
  const didMountRef = useRef(false);
  // Set by handleClick so hashchange can distinguish clicks (browser
  // handles smooth scroll) from user-initiated hash changes such as
  // typing a URL, pasting a link, or back/forward — those must land
  // instantly with no motion.
  const clickInitiatedRef = useRef(false);




  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;

    const visible = new Map<string, number>();
    // Coalesce rapid IntersectionObserver callbacks (fast scroll fires many)
    // into a single rAF-scheduled state update, so the underline layout
    // animation gets one smooth target per frame instead of stuttering.
    let scheduled = 0;
    let pendingId: string | null = null;
    const flush = () => {
      scheduled = 0;
      if (pendingId && pendingId !== null) {
        setActive((prev) => (prev === pendingId ? prev : (pendingId as string)));
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.intersectionRatio);
          } else {
            visible.delete(entry.target.id);
          }
        }
        if (Date.now() < suppressPersistUntilRef.current) return;
        if (visible.size === 0) return;
        const [topId] = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        pendingId = topId;
        if (!scheduled) {
          scheduled = requestAnimationFrame(flush);
        }
      },
      {
        // Account for sticky header (~4rem) + this sub-nav (~3rem)
        rootMargin: "-120px 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    els.forEach((el) => observer.observe(el));
    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      observer.disconnect();
    };
  }, []);

  // Push the active section into the URL hash (no scroll, no focus) so browser
  // back/forward navigates between highlighted sections and a refresh keeps
  // the same one. Skip the initial mount so we don't clobber an explicit
  // incoming hash before the hash-focus effect runs. Suppressed briefly after
  // a nav click (the native anchor click already pushed its own history
  // entry) so the smooth-scroll-driven IntersectionObserver doesn't stack
  // duplicates on top of it.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    // Debounce so an in-flight smooth scroll doesn't spam history with every
    // intermediate section it passes through — only the settled section is
    // pushed.
    const t = window.setTimeout(() => {
      if (Date.now() < suppressPersistUntilRef.current) return;
      if (window.location.hash.slice(1) === active) return;
      history.pushState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${active}`,
      );
    }, 600);
    return () => window.clearTimeout(t);
  }, [active]);



  // Focus target section on hash navigation (initial load + hashchange) so
  // keyboard/screen-reader users land inside the section, not stuck at the top.
  // Invalid hashes gracefully fall back to the top (hero) section.
  useEffect(() => {
    const validIds = new Set<string>(SECTIONS.map((s) => s.id));
    const focusFromHash = () => {
      // Any hash-driven navigation is explicit: suppress the observer briefly
      // so smooth-scroll-driven intersection updates don't overwrite the
      // freshly hash-derived active state and aria-current.
      suppressPersistUntilRef.current = Date.now() + 1000;
      // If this hashchange wasn't preceded by a nav click, treat it as
      // user-initiated (typed URL, pasted link, back/forward, external hash
      // update) and force instant scroll — no motion, immediate highlight.
      const isUserInitiated = !clickInitiatedRef.current;
      clickInitiatedRef.current = false;

      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = validIds.has(id) ? document.getElementById(id) : null;
      if (!el) {
        // Invalid or unknown hash — clear it, scroll to top, focus hero.
        const prefersReduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        history.replaceState(null, "", window.location.pathname + window.location.search);
        window.scrollTo({
          top: 0,
          behavior: isUserInitiated || prefersReduced ? "auto" : "smooth",
        });
        const hero = document.getElementById(SECTIONS[0].id);
        if (hero) focusSection(hero);
        setActive(SECTIONS[0].id);
        return;
      }
      if (isUserInitiated) {
        // Force instant scroll for typed/pasted URLs and back/forward
        // navigation. CSS has `scroll-behavior: smooth` globally, and
        // `scrollIntoView({ behavior: 'instant' })` isn't universally
        // honored — temporarily override the root's scroll-behavior so
        // scrollIntoView jumps immediately, then restore.
        const root = document.documentElement;
        const prev = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto";
        el.scrollIntoView({ block: "start" });
        // Restore next frame so subsequent user scrolls stay smooth.
        requestAnimationFrame(() => {
          root.style.scrollBehavior = prev;
        });
      }

      focusSection(el);
      setActive(id);
    };

    // Run after paint so the element exists and layout is settled.
    const raf = requestAnimationFrame(focusFromHash);
    window.addEventListener("hashchange", focusFromHash);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", focusFromHash);
    };
  }, []);


  // Let the browser handle the anchor click natively — it pushes a real
  // history entry, updates the hash, and fires hashchange (handled above to
  // focus + set active). We only suppress the IntersectionObserver briefly
  // so the smooth scroll doesn't flip active state to intermediate sections.
  const handleClick = (_e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!document.getElementById(id)) return;
    suppressPersistUntilRef.current = Date.now() + 1000;
    // Mark the upcoming hashchange as click-initiated so focusFromHash
    // preserves the browser's native smooth scroll instead of jumping.
    clickInitiatedRef.current = true;
    setActive(id);
  };




  return <NavList active={active} onNavClick={handleClick} />;
}

function NavList({
  active,
  onNavClick,
}: {
  active: string;
  onNavClick: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const reduce = useReducedMotion();

  return (
    <div className="sticky top-16 z-30 border-b border-arena-border bg-arena-bg/85 backdrop-blur-xl">
      <nav
        aria-label="Page sections"
        onMouseLeave={() => setHovered(null)}
        className="mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((s) => {
          const isActive = active === s.id;
          const isHovered = hovered === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => onNavClick(e, s.id)}
              onMouseEnter={() => setHovered(s.id)}
              onFocus={() => setHovered(s.id)}
              onBlur={() => setHovered((h) => (h === s.id ? null : h))}
              aria-current={isActive ? "true" : undefined}
              className={`relative shrink-0 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                isActive ? "text-white" : "text-muted-foreground hover:text-white"
              }`}
              style={{
                transition: "color 220ms ease, text-shadow 220ms ease",
                textShadow:
                  isActive || isHovered
                    ? "0 0 12px oklch(0.7 0.22 320 / 0.55)"
                    : "none",
              }}
            >
              {isHovered && !isActive && (
                <motion.span
                  layoutId="nav-hover-pill"
                  aria-hidden="true"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 380, damping: 32 }
                  }
                  className="absolute inset-0 -z-10 rounded-md"
                  style={{
                    background:
                      "linear-gradient(135deg, oklch(0.6 0.2 320 / 0.18), oklch(0.55 0.2 285 / 0.18))",
                    boxShadow: "0 0 24px -6px oklch(0.65 0.25 330 / 0.35)",
                  }}
                />
              )}
              <span className="relative">{s.label}</span>
              {isActive && (
                <motion.span
                  layoutId="nav-active-underline"
                  aria-hidden="true"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 320, damping: 30, mass: 0.7 }
                  }
                  className="absolute inset-x-2 -bottom-[9px] h-[2px] rounded-full"
                  style={{
                    backgroundImage: "var(--gradient-arena)",
                    boxShadow: "0 0 10px oklch(0.7 0.22 320 / 0.7)",
                  }}
                />
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
