import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState('Processing...');

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase puts tokens in the URL hash fragment after email link clicks
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const type = hashParams.get('type');

      // Also check query params (some flows use query params)
      const queryParams = new URLSearchParams(window.location.search);
      const queryType = queryParams.get('type');

      // Wait for Supabase to process the hash and establish the session
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        setMessage('Authentication error. Redirecting to login...');
        setTimeout(() => navigate('/login'), 2000);
        return;
      }

      // If this is a password recovery or invite, redirect to reset password page
      if (type === 'recovery' || type === 'invite' || queryType === 'recovery') {
        navigate('/reset-password');
        return;
      }

      // For email confirmation or other types, redirect to dashboard if session exists
      if (session) {
        navigate('/');
      } else {
        navigate('/login');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
