import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/dev/motion-test")({
  component: MotionTestPage,
  head: () => ({
    meta: [
      { title: "Motion & Anchor Nav Test" },
      {
        name: "description",
        content:
          "Dev-only test view for anchor navigation and animation utilities under prefers-reduced-motion.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

const SECTIONS = [
  { id: "fade", label: "Fade" },
  { id: "scale", label: "Scale" },
  { id: "slide", label: "Slide" },
  { id: "hover", label: "Hover" },
  { id: "story", label: "Story Link" },
  { id: "pulse", label: "Pulse" },
] as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className="scroll-mt-24 rounded-xl border border-arena-border bg-arena-card/40 p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`} className="mb-4 text-xl font-semibold text-white">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Replay({ children }: { children: (key: number) => React.ReactNode }) {
  const [key, setKey] = useState(0);
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => setKey((k) => k + 1)}
        className="rounded-md border border-arena-border bg-arena-bg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white hover:bg-arena-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        Replay
      </button>
      <div className="min-h-16">{children(key)}</div>
    </div>
  );
}

function MotionTestPage() {
  const reduced = useReducedMotion();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">Motion & Anchor Test</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Anchor links jump to sections; each demo triggers an animation
          utility. With <code>prefers-reduced-motion: reduce</code>, motion
          collapses to a near-instant state via the global CSS kill-switch.
        </p>
        <p
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-arena-border bg-arena-card/60 px-3 py-1 text-xs font-medium"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              reduced ? "bg-green-500" : "bg-yellow-500"
            }`}
          />
          prefers-reduced-motion:{" "}
          <span className="font-semibold text-white">
            {reduced ? "reduce (motion disabled)" : "no-preference (motion on)"}
          </span>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          To toggle in DevTools: Rendering panel → “Emulate CSS media feature
          prefers-reduced-motion”.
        </p>
      </header>

      <nav
        aria-label="Demo sections"
        className="sticky top-2 z-10 mb-8 flex flex-wrap gap-2 rounded-lg border border-arena-border bg-arena-bg/85 p-2 backdrop-blur-xl"
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {s.label}
          </a>
        ))}
        <Link
          to="/"
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          ← Home
        </Link>
      </nav>

      <div className="space-y-6">
        <Section id="fade" title="Fade in / out">
          <Replay>
            {(k) => (
              <div
                key={`fi-${k}`}
                className="animate-fade-in rounded-md bg-primary/20 px-4 py-3 text-sm text-white"
              >
                animate-fade-in
              </div>
            )}
          </Replay>
        </Section>

        <Section id="scale" title="Scale in / out">
          <Replay>
            {(k) => (
              <div
                key={`si-${k}`}
                className="animate-scale-in rounded-md bg-primary/20 px-4 py-3 text-sm text-white"
              >
                animate-scale-in
              </div>
            )}
          </Replay>
        </Section>

        <Section id="slide" title="Slide in right">
          <Replay>
            {(k) => (
              <div
                key={`sl-${k}`}
                className="animate-slide-in-right rounded-md bg-primary/20 px-4 py-3 text-sm text-white"
              >
                animate-slide-in-right
              </div>
            )}
          </Replay>
        </Section>

        <Section id="hover" title="Hover scale">
          <button
            type="button"
            className="hover-scale rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            Hover me (hover-scale)
          </button>
        </Section>

        <Section id="story" title="Story link underline">
          <a
            href="#story"
            className="story-link text-sm font-medium text-white"
          >
            Hover to reveal underline
          </a>
        </Section>

        <Section id="pulse" title="Pulse">
          <div
            aria-label="Pulsing indicator"
            className="pulse inline-block h-4 w-4 rounded-full bg-primary"
          />
        </Section>
      </div>
    </main>
  );
}
