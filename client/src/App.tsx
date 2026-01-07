import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import CountryView from "@/pages/CountryView";
import CampaignView from "@/pages/CampaignView";
import AdGroupView from "@/pages/AdGroupView";
import NotFound from "@/pages/not-found";
import { AgentChat } from "@/components/AgentChat";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/country/:code" component={CountryView} />
      <Route path="/campaign/:id" component={CampaignView} />
      <Route path="/ad-group/:id" component={AdGroupView} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
        <AgentChat />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
