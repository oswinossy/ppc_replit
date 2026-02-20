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

    // Listen for auth state changes from Supabase processing the URL tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // PASSWORD_RECOVERY is fired for both invite and forgot-password flows
      if (event === 'PASSWORD_RECOVERY' || queryType === 'recovery') {
        navigate('/reset-password');
        return;
      }

      // For normal sign-in (e.g. email confirmation), go to dashboard
      if (event === 'SIGNED_IN' && session) {
        navigate('/');
        return;
      }

      // If session established without specific event type, check query params
      if (session && event === 'INITIAL_SESSION') {
        if (queryType === 'recovery') {
          navigate('/reset-password');
        } else {
          navigate('/');
        }
        return;
      }
    });

    // Fallback: if no auth event fires within 5 seconds, redirect to login
    const timeout = setTimeout(() => {
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
