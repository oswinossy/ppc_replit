import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isPasswordSetupRequired: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  clearPasswordSetupRequired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordSetupRequired, setIsPasswordSetupRequired] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('passwordSetupRequired') === 'true';
    }
    return false;
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Detect password recovery flow (from forgot-password link)
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordSetupRequired(true);
      }

      // Detect invite flow: GoTrueClient fires SIGNED_IN (not PASSWORD_RECOVERY) for
      // type=invite. The sessionStorage flag was set in supabase.ts before the client
      // processed and cleared the URL hash.
      if (event === 'SIGNED_IN' && sessionStorage.getItem('passwordSetupRequired') === 'true') {
        setIsPasswordSetupRequired(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const clearPasswordSetupRequired = () => {
    setIsPasswordSetupRequired(false);
    sessionStorage.removeItem('passwordSetupRequired');
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const redirectTo = `${window.location.origin}/auth/callback?type=recovery`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: error ? new Error(error.message) : null };
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isPasswordSetupRequired, signIn, signOut, resetPassword, clearPasswordSetupRequired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
