import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { supabase } from './supabase';

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  /** Savings set aside from every paycheck; null = calculated automatically. */
  savings_per_check: number | null;
  /** 2-letter state for take-home estimates. */
  tax_state: string | null;
  /** Pre-tax retirement % taken from commission. */
  retirement_pct: number;
}

interface AuthState {
  session: Session | null;
  household: Household | null;
  loading: boolean;
  refreshHousehold: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHousehold = useCallback(async (s: Session | null) => {
    if (!s) {
      setHousehold(null);
      return;
    }
    // RLS returns only the household this user belongs to.
    const { data } = await supabase
      .from('households')
      .select('id, name, invite_code, savings_per_check, tax_state, retirement_pct')
      .maybeSingle();
    const h = data as Household | null;
    setHousehold(
      h
        ? {
            ...h,
            savings_per_check: h.savings_per_check == null ? null : Number(h.savings_per_check),
            retirement_pct: Number(h.retirement_pct ?? 0),
          }
        : null,
    );
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadHousehold(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer: Supabase recommends not awaiting queries inside this callback.
      setTimeout(() => loadHousehold(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadHousehold]);

  const value: AuthState = {
    session,
    household,
    loading,
    refreshHousehold: () => loadHousehold(session),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
