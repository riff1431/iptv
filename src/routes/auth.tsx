import { createFileRoute, useNavigate, useSearch, Link, ClientOnly } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff, Mail, User, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { trackEvent } from "@/lib/analytics";
import { getRememberMe, setRememberMe } from "@/lib/session-persistence";
import { saltPassword } from "@/lib/auth-salt";
import authHero from "@/assets/pgx/auth-hero.jpg";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";


const signInSchema = z.object({
  email: z.string().trim().min(1, "Email or username is required").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
  email: z.string().trim().email("Enter a valid email").max(255),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Only letters, numbers, . _ -"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

const authSearchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: authSearchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — PGX Sports Lounge" },
      { name: "description", content: "Sign in or join PGX Sports Lounge — watch, interact, dare and connect with creators." },
    ],
  }),
  component: AuthPage,
});

/**
 * Only accept same-origin, absolute-path redirects. Blocks open-redirect
 * vectors (`//evil.com`, `http://…`) and refuses to bounce back to `/auth`
 * itself (which would loop). Returns null when the value is unsafe/missing
 * so the caller falls back to the role-based default.
 */
function sanitizeRedirect(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Reject anything trying to encode a scheme (e.g. `/%2F/evil.com`).
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || /^\/*[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
  const { pathname } = splitLocation(raw);
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  return raw;
}

function splitLocation(target: string): { pathname: string; search: Record<string, string>; hash: string } {
  const hashIdx = target.indexOf("#");
  const hash = hashIdx >= 0 ? target.slice(hashIdx + 1) : "";
  const noHash = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const qIdx = noHash.indexOf("?");
  const pathname = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const qs = qIdx >= 0 ? noHash.slice(qIdx + 1) : "";
  const search: Record<string, string> = {};
  if (qs) {
    for (const [k, v] of new URLSearchParams(qs)) search[k] = v;
  }
  return { pathname, search, hash };
}


function PgxLogo() {
  return (
    <div className="flex flex-col items-center leading-none">
      <span
        className="font-hero text-5xl font-black tracking-tight bg-clip-text text-transparent sm:text-6xl"
        style={{ backgroundImage: "linear-gradient(90deg, var(--arena-pink), var(--arena-violet))" }}
      >
        PGX
      </span>
      <span className="mt-1.5 text-[11px] font-semibold tracking-[0.35em] text-white/70 sm:text-xs">
        SPORTS LOUNGE
      </span>
    </div>
  );
}

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const { user, isAdmin, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!loading && user && !redirectedRef.current) {
      redirectedRef.current = true;
      const fallback = isAdmin ? "/admin" : "/dashboard";
      const safeRedirect = sanitizeRedirect(search.redirect);
      const target = mode === "signup" ? "/dashboard" : (safeRedirect ?? fallback);
      trackEvent("auth_success", {
        mode,
        user_id: user.id,
        is_admin: isAdmin,
        redirect_to: target,
      });
      if (target === "/arena" || target.startsWith("/arena")) {
        trackEvent("auth_redirect_arena", {
          mode,
          user_id: user.id,
          source: safeRedirect ? "requested" : "fallback",
        });
      }
      // Split path/search/hash so TanStack navigate preserves each part
      // instead of treating the whole string as a literal pathname.
      const { pathname, search: qs, hash } = splitLocation(target);
      navigate({ to: pathname, search: qs, hash: hash || undefined, replace: true });
    }
  }, [loading, user, isAdmin, navigate, search.redirect, mode]);




  return (
    <ClientOnly fallback={null}>
      <main
        id="main"
        aria-label={mode === "signin" ? "Sign in" : "Create an account"}
        className="relative flex min-h-dvh items-center justify-center px-4 py-8 sm:px-6 sm:py-12"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, oklch(0.22 0.15 320 / 0.35), transparent 55%), radial-gradient(ellipse at 80% 100%, oklch(0.22 0.15 285 / 0.35), transparent 55%), var(--arena-bg)",
        }}
      >
        <div className="w-full max-w-lg md:max-w-2xl lg:max-w-3xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.8 }}
            >
              {mode === "signin" ? (
                <SignInCard onSwitch={() => setMode("signup")} redirect={search.redirect} />
              ) : (
                <SignUpCard onSwitch={() => setMode("signin")} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </ClientOnly>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
      whileHover={{ y: -3 }}
      className="relative overflow-hidden rounded-2xl border p-5 shadow-[0_30px_80px_-30px_rgba(217,70,239,0.35)] min-[360px]:p-6 sm:rounded-3xl sm:p-10 md:p-12"
      style={{
        borderColor: "oklch(0.4 0.15 310 / 0.35)",
        background:
          "linear-gradient(180deg, oklch(0.14 0.04 290 / 0.95), oklch(0.10 0.03 290 / 0.95))",
      }}
    >
      {/* animated aurora blobs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full blur-3xl"
        style={{ background: "oklch(0.65 0.25 330 / 0.35)" }}
        animate={{ x: [0, 30, -10, 0], y: [0, 20, -10, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "oklch(0.6 0.22 280 / 0.30)" }}
        animate={{ x: [0, -20, 15, 0], y: [0, -15, 20, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* model image on the right — hidden on mobile so form gets full width */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[45%] bg-cover bg-center opacity-90 md:block"
        style={{ backgroundImage: `url(${authHero})`, backgroundPosition: "center right" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{
          background:
            "linear-gradient(90deg, oklch(0.10 0.03 290) 45%, oklch(0.10 0.03 290 / 0.75) 65%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

function GradientButton({
  children,
  disabled,
  type = "submit",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className="w-full rounded-xl px-4 py-4 text-sm font-bold uppercase tracking-widest text-white shadow-[0_10px_30px_-10px_rgba(217,70,239,0.7)] transition hover:brightness-110 disabled:opacity-60 sm:text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.10_0.03_290)]"
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--arena-pink) 0%, var(--arena-violet) 55%, var(--arena-cyan) 100%)",
      }}
    >
      {disabled ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

function InputRow({
  icon: Icon,
  children,
  invalid,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
  invalid?: boolean;
}) {
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState(false);
  return (
    <motion.div
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // only clear when focus leaves the whole row
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      animate={
        reduce
          ? undefined
          : invalid
            ? { x: [0, -6, 6, -4, 4, 0], scale: 1 }
            : { x: 0, scale: focused ? 1.015 : 1 }
      }
      transition={
        invalid && !reduce
          ? { duration: 0.4, ease: "easeInOut" }
          : { type: "spring", stiffness: 320, damping: 22 }
      }
      className="flex items-center gap-3 rounded-xl border px-4 py-3.5 focus-within:border-arena-pink focus-within:ring-2 focus-within:ring-arena-pink/50"
      style={{
        borderColor: invalid ? "oklch(0.55 0.22 25 / 0.7)" : "oklch(0.35 0.1 300 / 0.4)",
        background: "oklch(0.08 0.02 285 / 0.6)",
      }}
    >
      <motion.span
        animate={reduce ? undefined : { rotate: invalid ? [0, -8, 8, 0] : 0, scale: focused ? 1.1 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="inline-flex"
      >
        <Icon
          className={`h-5 w-5 shrink-0 ${invalid ? "text-destructive" : focused ? "text-arena-pink" : "text-white/50"}`}
          aria-hidden={true}
        />
      </motion.span>
      {children}
    </motion.div>
  );
}

function FieldError({ msg, id }: { msg?: string; id: string }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {msg ? (
        <motion.p
          key={msg}
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="mt-1 overflow-hidden text-xs text-destructive"
        >
          {msg}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

const inputCls =
  "w-full bg-transparent text-base text-white placeholder:text-white/40 focus:outline-none";

function SocialButtons() {
  const [busy, setBusy] = useState(false);
  const btn =
    "hover-glow hover-shine flex w-full items-center justify-center gap-2 rounded-xl border border-arena-border bg-arena-bg/60 px-3 py-3.5 text-sm font-medium text-white/80 hover:border-arena-pink/60 hover:bg-white/10 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.10_0.03_290)] transition-all duration-300";

  async function signInWithGoogle() {
    setBusy(true);
    trackEvent("auth_start", { method: "google", mode: "oauth" });
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });

      if (result.error) {
        toast.error(result.error.message ?? "Google sign-in failed");
        setBusy(false);
        return;
      }
      if (result.redirected) return;
      // session set — auth listener will redirect
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  const notSupported = (name: string) =>
    toast.info(`${name} sign-in is coming soon`, {
      description: "For now, use Google or email to continue.",
    });

  return (
    <div
      className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-3"
      role="group"
      aria-label="Sign in with a social account"
      aria-busy={busy}
    >
      <SocialBtn
        className={btn}
        disabled={busy}
        aria-label={busy ? "Signing in with Google" : "Sign in with Google"}
        onClick={signInWithGoogle}
        busy={busy}
        label={busy ? "Connecting…" : "Google"}
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.42-1.66 4.15-5.5 4.15-3.31 0-6.01-2.74-6.01-6.13S8.69 5.99 12 5.99c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.9 3.4 14.66 2.4 12 2.4 6.86 2.4 2.7 6.56 2.7 11.7s4.16 9.3 9.3 9.3c5.37 0 8.93-3.77 8.93-9.08 0-.61-.07-1.08-.15-1.55H12z"/>
            <path fill="#34A853" d="M3.88 7.34l3.2 2.35C7.86 8.06 9.79 6.86 12 6.86c1.68 0 2.87.72 3.53 1.34l2.6-2.55C16.62 4.2 14.55 3.4 12 3.4c-3.42 0-6.35 1.96-7.79 4.79l-.33-.85z"/>
          </svg>
        }
      />
      <SocialBtn
        className={btn}
        disabled={busy}
        aria-label="Sign in with Twitter (coming soon)"
        onClick={() => notSupported("Twitter")}
        label="Twitter"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1DA1F2" aria-hidden="true" focusable="false">
            <path d="M23 4.55a9.36 9.36 0 0 1-2.68.74 4.68 4.68 0 0 0 2.05-2.58 9.34 9.34 0 0 1-2.97 1.13 4.67 4.67 0 0 0-7.95 4.26A13.26 13.26 0 0 1 1.64 3.16a4.66 4.66 0 0 0 1.44 6.23 4.63 4.63 0 0 1-2.11-.58v.06a4.67 4.67 0 0 0 3.74 4.58 4.7 4.7 0 0 1-2.1.08 4.67 4.67 0 0 0 4.36 3.24A9.36 9.36 0 0 1 0 18.7 13.22 13.22 0 0 0 7.15 20.8c8.58 0 13.27-7.1 13.27-13.27v-.6A9.44 9.44 0 0 0 23 4.55z"/>
          </svg>
        }
      />
      <SocialBtn
        className={btn}
        disabled={busy}
        aria-label="Sign in with Discord (coming soon)"
        onClick={() => notSupported("Discord")}
        label="Discord"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true" focusable="false">
            <path d="M20.32 4.37A19.79 19.79 0 0 0 15.43 3l-.24.5a17.66 17.66 0 0 1 3.83 1.24 15.14 15.14 0 0 0-13.04 0A17.66 17.66 0 0 1 9.81 3.5L9.57 3a19.79 19.79 0 0 0-4.89 1.37C1.66 8.85.87 13.2 1.26 17.48A19.9 19.9 0 0 0 7.27 20.5c.49-.67.93-1.38 1.3-2.13a12.9 12.9 0 0 1-2.06-.99c.17-.13.34-.26.5-.4a13.66 13.66 0 0 0 11.98 0c.16.14.33.27.5.4-.66.4-1.36.73-2.07.99.38.75.82 1.46 1.31 2.13a19.9 19.9 0 0 0 6.01-3.02c.5-4.97-.79-9.28-4.42-13.11zM8.52 15.02c-1.2 0-2.19-1.1-2.19-2.45s.97-2.46 2.19-2.46 2.21 1.11 2.19 2.46c0 1.35-.98 2.45-2.19 2.45zm6.96 0c-1.2 0-2.19-1.1-2.19-2.45s.97-2.46 2.19-2.46 2.21 1.11 2.19 2.46c0 1.35-.97 2.45-2.19 2.45z"/>
          </svg>
        }
      />
    </div>
  );
}

function SocialBtn({
  icon,
  label,
  busy,
  className,
  disabled,
  onClick,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
      whileHover={reduce || disabled ? undefined : { y: -2, scale: 1.02 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span
            key="spinner"
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="inline-flex"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </motion.span>
        ) : (
          <motion.span
            key="icon"
            initial={{ opacity: 0, rotate: 90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: -90, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="inline-flex"
          >
            {icon}
          </motion.span>
        )}
      </AnimatePresence>
      <motion.span
        key={label}
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
      >
        {label}
      </motion.span>
    </motion.button>
  );
}

function SignInCard({ onSwitch, redirect }: { onSwitch: () => void; redirect?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => getRememberMe());
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);
    const parsed = signInSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const next: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password" | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setBusy(true);
    setRememberMe(remember);
    trackEvent("auth_start", { method: "password", mode: "signin", redirect: redirect ?? null, remember });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: saltPassword(parsed.data.password),
      });
      if (error) throw error;
      toast.success("Signed in — welcome back!");
      // auth listener in root redirects
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Something went wrong";
      const lower = rawMsg.toLowerCase();
      if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
        const msg = "Invalid email or password.";
        setFieldErrors({ email: msg, password: msg });
        toast.error(msg);
      } else if (lower.includes("email not confirmed")) {
        const msg = "Please confirm your email before signing in.";
        setFieldErrors({ email: msg });
        toast.error(msg);
      } else {
        setFormError(rawMsg);
        toast.error(rawMsg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell>
      <Link to="/" className="mb-6 flex justify-center sm:mb-8">
        <PgxLogo />
      </Link>

      <div className="w-full md:max-w-[58%]">
        <h1 className="font-hero text-3xl font-black tracking-wide text-white sm:text-4xl">WELCOME BACK</h1>
        <p className="mt-2 text-sm text-white/60 sm:text-base">Sign in to continue your experience</p>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-3.5 sm:mt-7">
          <div>
            <InputRow icon={Mail} invalid={!!fieldErrors.email}>
              <label htmlFor="signin-email" className="sr-only">
                Email or username
              </label>
              <input
                id="signin-email"
                name="email"
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                }}
                placeholder="Email or Username"
                className={inputCls}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "signin-email-error" : undefined}
              />
            </InputRow>
            <FieldError id="signin-email-error" msg={fieldErrors.email} />
          </div>
          <div>
            <InputRow icon={Lock} invalid={!!fieldErrors.password}>
              <label htmlFor="signin-password" className="sr-only">
                Password
              </label>
              <input
                id="signin-password"
                name="password"
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
                placeholder="Password"
                className={inputCls}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? "signin-password-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="rounded text-white/50 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink"
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                aria-controls="signin-password"
              >
                {showPw ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </InputRow>
            <FieldError id="signin-password-error" msg={fieldErrors.password} />
          </div>


          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70 select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-[var(--arena-pink)]"
              />
              Remember me
            </label>
            <Link
              to="/forgot-password"
              className="text-sm font-semibold text-arena-pink hover:text-white transition-colors duration-200 focus:outline-none focus-visible:underline"
            >
              Forgot Password?
            </Link>
          </div>

          <AnimatePresence initial={false}>
            {formError && (
              <motion.div
                role="alert"
                aria-live="polite"
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="max-w-full overflow-hidden break-words whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-snug text-destructive"
              >
                {formError}
              </motion.div>
            )}
          </AnimatePresence>

          <GradientButton disabled={busy}>{busy ? "Signing in…" : "Sign In"}</GradientButton>
        </form>

        <div className="my-6 flex items-center gap-3 text-[11px] font-semibold tracking-widest text-white/40">
          <span className="h-px flex-1 bg-white/10" />
          OR CONTINUE WITH
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <SocialButtons />

        <p className="mt-7 text-center text-sm text-white/70">
          Don't have an account?{" "}
          <button
            type="button"
            onClick={onSwitch}
            className="font-semibold text-arena-pink hover:text-white transition-colors duration-200 focus:outline-none focus-visible:underline cursor-pointer"
          >
            Join PGX
          </button>
        </p>
      </div>
      {void redirect}
    </CardShell>
  );
}

type SignUpFields = "firstName" | "lastName" | "email" | "username" | "password" | "agree";

function SignUpCard({ onSwitch }: { onSwitch: () => void }) {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignUpFields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clearField = (k: SignUpFields) => {
    setFieldErrors((f) => (f[k] ? { ...f, [k]: undefined } : f));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);
    if (!agree) {
      setFieldErrors({ agree: "Please confirm you are 18+ and agree to the terms." });
      return;
    }
    const parsed = signUpSchema.safeParse({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      username: username.trim(),
      password,
    });
    if (!parsed.success) {
      const next: Partial<Record<SignUpFields, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as SignUpFields | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setBusy(true);
    trackEvent("auth_start", { method: "password", mode: "signup" });
    try {
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: saltPassword(parsed.data.password),
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            display_name: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
            username: parsed.data.username,
            first_name: parsed.data.firstName,
            last_name: parsed.data.lastName,
          },
        },
      });
      if (error) throw error;
      if (data.session) {
        toast.success("Account created — welcome to PGX!");
        navigate({ to: "/dashboard", replace: true });
      } else {
        toast.success("Account created — check your email to confirm.");
        onSwitch();
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Something went wrong";
      const lower = rawMsg.toLowerCase();
      if (lower.includes("already registered") || lower.includes("already been registered") || lower.includes("user already")) {
        const msg = "An account with this email already exists. Try signing in.";
        setFieldErrors({ email: msg });
        toast.error(msg);
      } else if (lower.includes("password")) {
        setFieldErrors({ password: rawMsg });
        toast.error(rawMsg);
      } else if (lower.includes("email")) {
        setFieldErrors({ email: rawMsg });
        toast.error(rawMsg);
      } else if (lower.includes("username")) {
        setFieldErrors({ username: rawMsg });
        toast.error(rawMsg);
      } else {
        setFormError(rawMsg);
        toast.error(rawMsg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell>
      <Link to="/" className="mb-5 flex justify-center sm:mb-6">
        <PgxLogo />
      </Link>

      <div className="w-full md:max-w-[58%]">
        <h1 className="font-hero text-2xl font-black tracking-wide text-white sm:text-3xl">
          CREATE YOUR ACCOUNT
        </h1>
        <p className="mt-2 text-sm text-white/60 sm:text-base">Join PGX and start your adventure</p>

        <form onSubmit={onSubmit} noValidate className="mt-5 space-y-3.5 sm:mt-6">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <InputRow icon={User} invalid={!!fieldErrors.firstName}>
                <label htmlFor="signup-firstName" className="sr-only">First name</label>
                <input
                  id="signup-firstName"
                  name="given-name"
                  type="text"
                  required
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); clearField("firstName"); }}
                  placeholder="First Name"
                  className={inputCls}
                  aria-invalid={!!fieldErrors.firstName}
                  aria-describedby={fieldErrors.firstName ? "signup-firstName-error" : undefined}
                />
              </InputRow>
              <FieldError id="signup-firstName-error" msg={fieldErrors.firstName} />
            </div>
            <div>
              <InputRow icon={User} invalid={!!fieldErrors.lastName}>
                <label htmlFor="signup-lastName" className="sr-only">Last name</label>
                <input
                  id="signup-lastName"
                  name="family-name"
                  type="text"
                  required
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); clearField("lastName"); }}
                  placeholder="Last Name"
                  className={inputCls}
                  aria-invalid={!!fieldErrors.lastName}
                  aria-describedby={fieldErrors.lastName ? "signup-lastName-error" : undefined}
                />
              </InputRow>
              <FieldError id="signup-lastName-error" msg={fieldErrors.lastName} />
            </div>
          </div>
          <div>
            <InputRow icon={Mail} invalid={!!fieldErrors.email}>
              <label htmlFor="signup-email" className="sr-only">Email address</label>
              <input
                id="signup-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearField("email"); }}
                placeholder="Email Address"
                className={inputCls}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
              />
            </InputRow>
            <FieldError id="signup-email-error" msg={fieldErrors.email} />
          </div>
          <div>
            <InputRow icon={User} invalid={!!fieldErrors.username}>
              <label htmlFor="signup-username" className="sr-only">Username</label>
              <input
                id="signup-username"
                name="username"
                type="text"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => { setUsername(e.target.value); clearField("username"); }}
                placeholder="Username"
                className={inputCls}
                aria-invalid={!!fieldErrors.username}
                aria-describedby={fieldErrors.username ? "signup-username-error" : undefined}
              />
            </InputRow>
            <FieldError id="signup-username-error" msg={fieldErrors.username} />
          </div>
          <div>
            <InputRow icon={Lock} invalid={!!fieldErrors.password}>
              <label htmlFor="signup-password" className="sr-only">Password</label>
              <input
                id="signup-password"
                name="new-password"
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearField("password"); }}
                placeholder="Password"
                className={inputCls}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="rounded text-white/50 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink"
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                aria-controls="signup-password"
              >
                {showPw ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </InputRow>
            <FieldError id="signup-password-error" msg={fieldErrors.password} />
          </div>


          <div>
            <label className="flex items-start gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => { setAgree(e.target.checked); clearField("agree"); }}
                className="mt-0.5 h-4 w-4 accent-[var(--arena-pink)]"
                aria-invalid={!!fieldErrors.agree}
                aria-describedby={fieldErrors.agree ? "signup-agree-error" : undefined}
              />
              <span>
                I am 18+ and agree to the{" "}
                <Link to="/terms" className="font-semibold text-arena-pink hover:text-white transition-colors duration-200 focus:outline-none focus-visible:underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="font-semibold text-arena-pink hover:text-white transition-colors duration-200 focus:outline-none focus-visible:underline">
                  Privacy Policy
                </Link>
              </span>
            </label>
            <FieldError id="signup-agree-error" msg={fieldErrors.agree} />
          </div>

          <AnimatePresence initial={false}>
            {formError && (
              <motion.div
                role="alert"
                aria-live="polite"
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="max-w-full overflow-hidden break-words whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm leading-snug text-destructive"
              >
                {formError}
              </motion.div>
            )}
          </AnimatePresence>

          <GradientButton disabled={busy}>
            {busy ? "Creating…" : "Create Account"}
          </GradientButton>
        </form>

        <p className="mt-6 text-center text-sm text-white/70">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onSwitch}
            className="font-semibold text-arena-pink hover:text-white transition-colors duration-200 focus:outline-none focus-visible:underline cursor-pointer"
          >
            Sign in
          </button>
        </p>
      </div>
    </CardShell>
  );
}
