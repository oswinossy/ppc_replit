import { type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, isPasswordSetupRequired } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // If the user arrived via invite/recovery and hasn't set a password yet,
  // redirect them to the password setup page instead of the dashboard
  if (isPasswordSetupRequired) {
    return <Redirect to="/reset-password" />;
  }

  return <>{children}</>;
}
