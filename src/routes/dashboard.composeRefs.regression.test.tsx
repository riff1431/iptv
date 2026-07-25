import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Regression: the dashboard mixes Radix triggers (AlertDialogTrigger,
 * DropdownMenuTrigger) with `asChild` + shadcn `Button`. Under that combo
 * Radix wires our child's ref through `composeRefs`, which walks a chain of
 * callback refs. If any callback ref in the chain calls `setState` — or is
 * re-created every render so React thinks the ref identity changed and must
 * be re-invoked — the trigger renders, setState fires, parent re-renders,
 * trigger re-renders, setState fires again → "Maximum update depth exceeded".
 *
 * This suite renders the exact JSX shapes used in `src/routes/dashboard.tsx`
 * (reset-to-defaults AlertDialog + test-notification DropdownMenu) and
 * verifies:
 *  1. Mount does NOT enter an infinite render loop.
 *  2. A parent whose state changes on mount stabilises within a small
 *     render budget (i.e. no runaway updates from the trigger tree).
 *  3. Passing a stable callback ref to the trigger's child does not
 *     retrigger the loop we previously observed.
 *
 * If the loop regresses, React logs `Maximum update depth exceeded` and the
 * render counter blows past the budget → the assertions fail loudly.
 */

// Silence expected act warnings if any variant re-renders synchronously.
const consoleErrors: string[] = [];
const originalConsoleError = console.error;

function trackConsoleErrors() {
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  };
}
function restoreConsoleError() {
  console.error = originalConsoleError;
}

afterEach(() => {
  cleanup();
  restoreConsoleError();
  consoleErrors.length = 0;
});

/** Counts every render of the component body. */
function RenderCounter({ tag }: { tag: { count: number } }) {
  tag.count += 1;
  return null;
}

describe("Dashboard composeRefs callback-ref loop regression", () => {
  it("AlertDialogTrigger asChild + Button mounts without an infinite render loop", () => {
    const tag = { count: 0 };
    trackConsoleErrors();

    render(
      <div>
        <RenderCounter tag={tag} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              Reset to defaults
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset notification preferences?</AlertDialogTitle>
              <AlertDialogDescription>Are you sure?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>,
    );

    // A healthy mount renders the counter once (StrictMode is off here).
    // We give it a generous 5x budget; a composeRefs loop trivially blows
    // past this into the thousands before React aborts.
    expect(tag.count).toBeLessThan(5);
    expect(
      consoleErrors.some((e) => e.includes("Maximum update depth")),
    ).toBe(false);
  });

  it("DropdownMenuTrigger asChild + Button mounts without an infinite render loop", () => {
    const tag = { count: 0 };
    trackConsoleErrors();

    render(
      <div>
        <RenderCounter tag={tag} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label="Choose test category">
              Category…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Wallet</DropdownMenuItem>
            <DropdownMenuItem>Matches</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );

    expect(tag.count).toBeLessThan(5);
    expect(
      consoleErrors.some((e) => e.includes("Maximum update depth")),
    ).toBe(false);
  });

  it("stable useCallback ref forwarded through composeRefs does not loop", () => {
    const tag = { count: 0 };
    trackConsoleErrors();

    function Harness() {
      tag.count += 1;
      // A stable callback ref (empty deps) — the fixed shape. If we had
      // returned a fresh function each render, React would re-invoke the
      // ref on every render and, combined with composeRefs, could feed
      // a downstream setState loop.
      const nodeRef = useRef<HTMLElement | null>(null);
      const setRef = useCallback((el: HTMLElement | null) => {
        nodeRef.current = el;
      }, []);
      return (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button ref={setRef} size="sm">
              Trigger
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Title</AlertDialogTitle>
              <AlertDialogDescription>Body</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    render(<Harness />);
    expect(tag.count).toBeLessThan(5);
    expect(
      consoleErrors.some((e) => e.includes("Maximum update depth")),
    ).toBe(false);
  });

  it("parent state-change on mount stabilises with trigger present (no runaway updates)", () => {
    const tag = { count: 0 };
    trackConsoleErrors();

    function Harness() {
      tag.count += 1;
      const [n, setN] = useState(0);
      // A single, bounded setState on mount. If the trigger tree is
      // healthy, we expect ~2 renders (initial + post-setState). If a
      // composeRefs loop kicks in, React will exceed the update-depth
      // cap almost immediately.
      const bumpedRef = useRef(false);
      if (!bumpedRef.current) {
        bumpedRef.current = true;
        queueMicrotask(() => setN(1));
      }
      return (
        <div data-n={n}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm">Reset</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Title</AlertDialogTitle>
                <AlertDialogDescription>Body</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      );
    }

    render(<Harness />);
    // Give the microtask + resulting rerender a chance to flush.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(tag.count).toBeLessThan(8);
        expect(
          consoleErrors.some((e) => e.includes("Maximum update depth")),
        ).toBe(false);
        resolve();
      }, 50);
    });
  });
});

// Silence unused-import warning if a variant is stripped by a future refactor.
export type _Keep = ReactNode;
