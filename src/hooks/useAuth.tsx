import { useEffect, useMemo, useState, useCallback, useRef, createContext, useContext, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { clearEphemeralSession } from "@/lib/session-persistence";


export type AppRole = "admin" | "moderator" | "user";

export interface AuthState {
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const PROJECT_ID = typeof window !== "undefined" ? import.meta.env.VITE_SUPABASE_PROJECT_ID : undefined;
const AUTH_KEY = PROJECT_ID ? `sb-${PROJECT_ID}-auth-token` : null;

function getInitialUser(): User | null {
  if (typeof window === "undefined" || !AUTH_KEY) return null;
  try {
    const val = window.localStorage.getItem(AUTH_KEY);
    if (!val) return null;
    const session = JSON.parse(val);
    return session?.user ?? null;
  } catch {
    return null;
  }
}

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data.map((r) => r.role as AppRole);
}

function notifyAdminGrantedOnce(userId: string) {
  if (typeof window === "undefined") return;
  const key = `admin-granted-notified:${userId}`;
  try {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, new Date().toISOString());
  } catch {
    // ignore storage errors; still toast
  }
  toast.success("You've been granted admin access", {
    description: "Your account now has admin privileges.",
    duration: 8000,
  });
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuthState(): AuthState {
  const [user, setUser] = useState<User | null>(getInitialUser);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const prevAdminRef = useRef<boolean | null>(null);

  const applyRoles = useCallback((userId: string, next: AppRole[]) => {
    setRoles(next);
    const isAdminNow = next.includes("admin");
    const wasAdmin = prevAdminRef.current;
    if (isAdminNow && wasAdmin === false) {
      // Transition false -> true within this session
      notifyAdminGrantedOnce(userId);
    } else if (isAdminNow && wasAdmin === null) {
      // First observation this session: toast once per browser via localStorage guard
      notifyAdminGrantedOnce(userId);
    }
    prevAdminRef.current = isAdminNow;
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const u = data.user ?? null;
      setUser(u);
      if (u) applyRoles(u.id, await fetchRoles(u.id));
      else {
        setRoles([]);
        prevAdminRef.current = null;
      }
    } catch {
      // Network / transient failure — treat as signed-out for this tick
      // instead of leaving `loading` stuck true, which caused downstream
      // guard components to spin and CatchBoundary to retry in a loop.
      setUser(null);
      setRoles([]);
      prevAdminRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [applyRoles]);

  useEffect(() => {
    let mounted = true;
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        const u = session?.user ?? null;
        setUser(u);
        if (u) void fetchRoles(u.id).then((r) => applyRoles(u.id, r));
        else {
          setRoles([]);
          prevAdminRef.current = null;
        }
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [load, applyRoles]);

  // Live-detect admin grants (bootstrap/allowlist triggers insert into user_roles)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-roles-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_roles",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const role = (payload.new as { role?: AppRole } | null)?.role;
          if (!role) return;
          setRoles((prev) => {
            if (prev.includes(role)) return prev;
            const next = [...prev, role];
            if (role === "admin" && !prev.includes("admin")) {
              notifyAdminGrantedOnce(user.id);
              prevAdminRef.current = true;
            }
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearEphemeralSession();
    setUser(null);
    setRoles([]);
    prevAdminRef.current = null;
  }, []);

  return useMemo(
    () => ({
      user,
      roles,
      loading,
      isAdmin: roles.includes("admin"),
      isModerator: roles.includes("moderator") || roles.includes("admin"),
      signOut,
      refresh: load,
    }),
    [user, roles, loading, signOut, load],
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // Fallback to local state hook for isolated testing/storybooks where provider isn't mounted
    return useAuthState();
  }
  return context;
}

