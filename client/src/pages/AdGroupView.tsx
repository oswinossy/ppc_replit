import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import RecommendationCard from "@/components/RecommendationCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Sparkles } from "lucide-react";
import { useRoute } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdGroupView() {
  const [, params] = useRoute("/ad-group/:id");
  const adGroupId = params?.id || "";
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });
  const [showRecommendations, setShowRecommendations] = useState(false);
  const { toast } = useToast();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['/api/kpis', adGroupId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        adGroupId,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/kpis?${params}`);
      return response.json();
    },
  });

  const { data: searchTerms, isLoading: searchTermsLoading } = useQuery({
    queryKey: ['/api/search-terms', adGroupId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        adGroupId,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/search-terms?${params}`);
      return response.json();
    },
  });

  const { data: placements, isLoading: placementsLoading } = useQuery({
    queryKey: ['/api/placements', adGroupId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        adGroupId,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/placements?${params}`);
      return response.json();
    },
  });

  const generateRecommendationsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/recommendations/generate', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'ad_group',
          scopeId: adGroupId,
          from: dateRange.from,
          to: dateRange.to,
          targetAcos: 20,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      return response.json();
    },
    onSuccess: () => {
      setShowRecommendations(true);
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations', adGroupId] });
      toast({ title: "Recommendations generated successfully" });
    },
  });

  const { data: recommendationsData } = useQuery({
    queryKey: ['/api/recommendations', adGroupId, dateRange],
    enabled: showRecommendations,
    queryFn: async () => {
      const result = await generateRecommendationsMutation.mutateAsync();
      return result;
    },
  });

  const recommendations = recommendationsData?.recommendations;

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ 
      adGroupId,
      from: dateRange.from, 
      to: dateRange.to 
    });
    window.open(`/api/exports/negatives.xlsx?${params}`, '_blank');
  };

  const kpiCards = (kpis && !kpis.error) ? [
    { label: "Ad Sales", value: kpis.adSales?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "ACOS", value: `${kpis.acos?.toFixed(1) || '0'}%` },
    { label: "CPC", value: kpis.cpc?.toFixed(2) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "Cost", value: kpis.cost?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "CVR", value: `${((kpis.orders / kpis.clicks) * 100 || 0).toFixed(1)}%` },
    { label: "Orders", value: kpis.orders?.toLocaleString() || '0' },
  ] : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <BreadcrumbNav items={[
              { label: "Dashboard", href: "/" },
              { label: "Ad Group" }
            ]} />
          </div>
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2" 
              onClick={handleExportNegatives}
              data-testid="button-export"
            >
              <Download className="h-4 w-4" />
              Export Negatives
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <TimeRangePicker value={dateRange} onChange={setDateRange} />
          <div className="flex items-center gap-2">
            <FilterChip label="Ad Group" value={adGroupId} />
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))
          ) : (
            kpiCards.map((kpi) => (
              <KPICard key={kpi.label} {...kpi} />
            ))
          )}
        </div>

        <Tabs defaultValue="search-terms" className="space-y-6">
          <TabsList>
            <TabsTrigger value="search-terms" data-testid="tab-search-terms">Search Terms</TabsTrigger>
            <TabsTrigger value="placements" data-testid="tab-placements">Placements</TabsTrigger>
          </TabsList>

          <TabsContent value="search-terms" className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Search Terms</h2>
                  <p className="text-sm text-muted-foreground">Performance by search term with bid recommendations</p>
                </div>
                <Button 
                  className="gap-2" 
                  onClick={() => generateRecommendationsMutation.mutate()}
                  disabled={generateRecommendationsMutation.isPending}
                  data-testid="button-generate-recommendations"
                >
                  <Sparkles className="h-4 w-4" />
                  {generateRecommendationsMutation.isPending ? "Generating..." : showRecommendations ? "Hide" : "Generate"} Recommendations
                </Button>
              </div>
              
              {searchTermsLoading ? (
                <Skeleton className="h-64" />
              ) : searchTerms ? (
                <DataTable
                  columns={[
                    { key: "searchTerm", label: "Search Term", sortable: true },
                    { key: "matchType", label: "Match Type", sortable: true, render: (val) => <Badge variant="outline">{val}</Badge> },
                    { key: "clicks", label: "Clicks", align: "right", sortable: true },
                    { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                    { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                    { key: "orders", label: "Orders", align: "right", sortable: true },
                    { key: "cpc", label: "CPC", align: "right", sortable: true, render: (val) => `€${val.toFixed(2)}` },
                    { key: "cvr", label: "CVR", align: "right", sortable: true, render: (val) => `${val.toFixed(1)}%` },
                    { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                    { key: "currentBid", label: "Current Bid", align: "right", sortable: true, render: (val) => `€${val.toFixed(2)}` },
                  ]}
                  data={searchTerms}
                />
              ) : null}
            </div>

            {showRecommendations && recommendations && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Bid Recommendations</h3>
                  <p className="text-sm text-muted-foreground">Targeting 20% ACOS - {recommendations.length} recommendations generated</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recommendations.map((rec: any) => (
                    <RecommendationCard 
                      key={rec.searchTerm} 
                      searchTerm={rec.searchTerm}
                      currentBid={rec.currentBid}
                      proposedBid={rec.proposedBid}
                      clicks={rec.clicks}
                      acos={rec.acos}
                      target={rec.targetAcos}
                      rationale={rec.rationale}
                      currency={kpis?.currency === 'EUR' ? '€' : kpis?.currency || '€'} 
                    />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="placements" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Placement Performance</h2>
              <p className="text-sm text-muted-foreground">Top of Search (TOS) vs Rest of Search (ROS) vs Product Pages (PP)</p>
            </div>
            {placementsLoading ? (
              <Skeleton className="h-64" />
            ) : placements ? (
              <DataTable
                columns={[
                  { key: "placement", label: "Placement", sortable: true },
                  { key: "clicks", label: "Clicks", align: "right", sortable: true },
                  { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                ]}
                data={placements}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
