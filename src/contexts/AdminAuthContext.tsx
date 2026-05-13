/**
 * AdminAuthContext — Contexto de autenticação exclusivo para o painel admin.
 *
 * Completamente separado do AuthContext principal:
 * - Não verifica org membership
 * - Verifica apenas user_roles.role = 'admin'
 * - Usado apenas pelas rotas /admin/*
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AdminAuthContextType {
  admin: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin]     = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const resolveAdmin = useCallback(async (user: User | null) => {
    if (!user) {
      setAdmin(null);
      setSession(null);
      return;
    }
    // Only grant access if user_roles.role = 'admin'
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data?.role === "admin") {
      setAdmin(user);
    } else {
      setAdmin(null);
    }
  }, []);

  useEffect(() => {
    let currentUserId: string | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, sess) => {
        setSession(sess);
        const nextId = sess?.user?.id ?? null;

        if (nextId !== currentUserId) {
          currentUserId = nextId;
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(() => resolveAdmin(sess?.user ?? null), 0);
        }

        if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"].includes(event)) {
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      if (sess?.user && currentUserId !== sess.user.id) {
        currentUserId = sess.user.id;
        resolveAdmin(sess.user);
      } else if (!sess) {
        setAdmin(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [resolveAdmin]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAdmin(null);
    setSession(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, session, loading, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
