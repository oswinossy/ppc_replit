import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Dashboard from "@/pages/Dashboard";
import CountryView from "@/pages/CountryView";
import CampaignView from "@/pages/CampaignView";
import AdGroupView from "@/pages/AdGroupView";
import BiddingStrategy from "@/pages/BiddingStrategy";
import LoginPage from "@/pages/LoginPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import NotFound from "@/pages/not-found";
import { Redirect } from "wouter";

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (user) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicRoute><LoginPage /></PublicRoute>
      </Route>
      <Route path="/forgot-password">
        <PublicRoute><ForgotPasswordPage /></PublicRoute>
      </Route>
      <Route path="/reset-password">
        <ResetPasswordPage />
      </Route>
      <Route path="/auth/callback">
        <AuthCallbackPage />
      </Route>

      <Route path="/">
        <ProtectedRoute><Dashboard /></ProtectedRoute>
      </Route>
      <Route path="/country/:code">
        <ProtectedRoute><CountryView /></ProtectedRoute>
      </Route>
      <Route path="/campaign/:id">
        <ProtectedRoute><CampaignView /></ProtectedRoute>
      </Route>
      <Route path="/ad-group/:id">
        <ProtectedRoute><AdGroupView /></ProtectedRoute>
      </Route>
      <Route path="/bidding-strategy">
        <ProtectedRoute><BiddingStrategy /></ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
