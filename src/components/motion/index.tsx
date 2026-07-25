import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import gsap from "gsap";

/**
 * Global motion primitives — playful & bouncy spring feel.
 * Used across auth, landing, and shared UI to add smooth, modern
 * micro-interactions without changing business logic.
 */

const SPRING = { type: "spring" as const, stiffness: 260, damping: 22, mass: 0.9 };
const SOFT_SPRING = { type: "spring" as const, stiffness: 180, damping: 24 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: SPRING },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

/** Fades / springs children into view when scrolled into viewport. */
export function Reveal({
  children,
  delay = 0,
  className,
  as,
  y = 24,
  once = true,
  ...rest
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  once?: boolean;
  as?: "div" | "section" | "header" | "article";
} & Omit<HTMLMotionProps<"div">, "children">) {
  const reduce = useReducedMotion();
  const Comp = motion[as ?? "div"];
  if (reduce) {
    return (
      <Comp className={className} {...rest}>
        {children}
      </Comp>
    );
  }
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once, amount: 0.2 }}
      transition={{ ...SPRING, delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/** Hover-lift wrapper with springy scale + shadow bloom. */
export function MotionCard({
  children,
  className,
  hoverScale = 1.02,
  ...rest
}: {
  children: ReactNode;
  hoverScale?: number;
} & Omit<HTMLMotionProps<"div">, "children">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { scale: hoverScale, y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={SOFT_SPRING}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Springy interactive wrapper for buttons/links. */
export function MotionTap({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
} & Omit<HTMLMotionProps<"div">, "children">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { scale: 1.04 }}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      transition={SPRING}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Smooth page/route transitions keyed off pathname. */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const state = useRouterState();
  const pathname = state.location.pathname;
  // Prefetch on-idle
  void router;

  if (reduce) return <>{children}</>;

  // NOTE: no `mode="wait"` — keeping the outgoing route mounted while its
  // exit animation plays can re-trigger effects in route guards (RequireAuth)
  // and cause redirect loops. Cross-fading is fine: the new route mounts
  // immediately and the old one animates out in parallel.
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** GSAP-powered subtle float/parallax on an element ref. Skipped when the user prefers reduced motion. */
export function useGsapFloat<T extends HTMLElement>(
  enabled = true,
  opts: { y?: number; duration?: number } = {},
) {
  const ref = useRef<T | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!enabled || reduce || !ref.current) return;
    const { y = 10, duration = 3.2 } = opts;
    const tween = gsap.to(ref.current, {
      y,
      duration,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reduce]);
  return ref;
}

export { motion, AnimatePresence };
