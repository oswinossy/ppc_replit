import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState('Processing...');

  useEffect(() => {
    // Check query params for our custom type markers (from forgot-password redirectTo)
    const queryParams = new URLSearchParams(window.location.search);
    const queryType = queryParams.get('type');

    // Check if this is an invite flow (flag set in supabase.ts before hash was cleared)
    const isInviteFlow = sessionStorage.getItem('passwordSetupRequired') === 'true';

    // Listen for auth state changes from Supabase processing the URL tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // PASSWORD_RECOVERY is fired for forgot-password flows
      if (event === 'PASSWORD_RECOVERY' || queryType === 'recovery') {
        navigate('/reset-password');
        return;
      }

      // Invite flow: GoTrueClient fires SIGNED_IN (not PASSWORD_RECOVERY) for type=invite.
      // We detect it via the sessionStorage flag set in supabase.ts.
      if (event === 'SIGNED_IN' && isInviteFlow) {
        navigate('/reset-password');
        return;
      }

      // For normal sign-in (e.g. email confirmation), go to dashboard
      if (event === 'SIGNED_IN' && session) {
        navigate('/');
        return;
      }

      // If session established without specific event type, check flags
      if (session && event === 'INITIAL_SESSION') {
        if (queryType === 'recovery' || isInviteFlow) {
          navigate('/reset-password');
        } else {
          navigate('/');
        }
        return;
      }
    });

    // Fallback: if no auth event fires within 5 seconds, redirect to login
    const timeout = setTimeout(() => {
      sessionStorage.removeItem('passwordSetupRequired');
      setMessage('Session expired. Redirecting to login...');
      navigate('/login');
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
