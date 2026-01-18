import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import RecommendationCard from "@/components/RecommendationCard";
import CurrencyBadge from "@/components/CurrencyBadge";
import { AgentChat } from "@/components/AgentChat";
import { Button } from "@/components/ui/button";
import { Download, Sparkles } from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "@/hooks/useSearchParams";

export default function AdGroupView() {
  const [, params] = useRoute("/ad-group/:id");
  const adGroupId = params?.id || "";
  
  // Extract country, campaignType, and campaignId from query parameters
  const { country: countryCode, campaignType, campaignId } = useSearchParams();
  
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });
  const [showRecommendations, setShowRecommendations] = useState(false);
  
  // Get display name for campaign type
  const campaignTypeLabel = campaignType === 'brands' ? 'Sponsored Brands' : 
                            campaignType === 'display' ? 'Display' : 'Sponsored Products';
  const { toast } = useToast();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['/api/kpis', adGroupId, campaignType, countryCode, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        adGroupId,
        campaignType,
        from: dateRange.from, 
        to: dateRange.to 
      });
      // When country is present, display in local currency
      if (countryCode) {
        params.append('country', countryCode);
        params.append('convertToEur', 'false');
      }
      const response = await fetch(`/api/kpis?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const { data: searchTerms, isLoading: searchTermsLoading, error: searchTermsError } = useQuery({
    queryKey: ['/api/search-terms', adGroupId, campaignId, campaignType, countryCode, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        adGroupId,
        campaignType,
        from: dateRange.from, 
        to: dateRange.to 
      });
      // Pass campaignId for campaign-specific ACOS target lookup
      if (campaignId) {
        params.append('campaignId', campaignId);
      }
      // When country is present, display in local currency
      if (countryCode) {
        params.append('country', countryCode);
        params.append('convertToEur', 'false');
      }
      const response = await fetch(`/api/search-terms?${params}`);
      
      // If error (e.g., multi-currency issue or missing ACOS target), handle appropriately
      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.error?.includes('multiple currencies')) {
          // Retry without country filter to get EUR-converted data
          const retryParams = new URLSearchParams({ 
            adGroupId,
            campaignType,
            from: dateRange.from, 
            to: dateRange.to,
            convertToEur: 'true'
          });
          if (campaignId) {
            retryParams.append('campaignId', campaignId);
          }
          const retryResponse = await fetch(`/api/search-terms?${retryParams}`);
          if (!retryResponse.ok) {
            throw new Error('Failed to fetch search terms');
          }
          return retryResponse.json();
        }
        throw new Error(errorData.message || errorData.error || 'Failed to fetch search terms');
      }
      
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });


  const generateRecommendationsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/recommendations/generate', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'ad_group',
          scopeId: adGroupId,
          campaignId: campaignId || undefined,
          campaignType,
          from: dateRange.from,
          to: dateRange.to,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to generate recommendations');
      }
      return response.json();
    },
    onSuccess: () => {
      setShowRecommendations(true);
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations', adGroupId] });
      toast({ title: "Recommendations generated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to generate recommendations",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const { data: recommendationsData } = useQuery({
    queryKey: ['/api/recommendations', adGroupId, campaignType, dateRange],
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
      campaignType,
      from: dateRange.from, 
      to: dateRange.to 
    });
    window.open(`/api/exports/negatives.xlsx?${params}`, '_blank');
  };

  const handleExportRecommendations = async () => {
    const params = new URLSearchParams({ 
      adGroupId,
      campaignType,
      from: dateRange.from, 
      to: dateRange.to 
    });
    window.open(`/api/exports/recommendations.csv?${params}`, '_blank');
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
              { label: "Dashboard", href: `/?campaignType=${campaignType}` },
              { label: countryCode || "", href: countryCode ? `/country/${countryCode}?campaignType=${campaignType}` : undefined },
              { label: `Ad Group (${campaignTypeLabel})` }
            ].filter(item => item.label)} />
            <CurrencyBadge countryCode={countryCode} />
          </div>
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2" 
              onClick={handleExportRecommendations}
              data-testid="button-export-recommendations"
            >
              <Download className="h-4 w-4" />
              Export Bids CSV
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2" 
              onClick={handleExportNegatives}
              data-testid="button-export-negatives"
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
          <div className="flex items-center gap-4">
            <TimeRangePicker value={dateRange} onChange={setDateRange} />
            <AgentChat />
          </div>
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

        <div className="space-y-6">
          <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Targeting</h2>
                  <p className="text-sm text-muted-foreground">Performance by targeting keyword/ASIN with bid recommendations</p>
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
                    { key: "targeting", label: "Targeting", sortable: true },
                    { key: "matchType", label: "Match Type", sortable: true, render: (val) => <Badge variant="outline">{val}</Badge> },
                    { key: "clicks", label: "Clicks", align: "right", sortable: true },
                    { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => `€${(val ?? 0).toFixed(2)}` },
                    { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => `€${(val ?? 0).toFixed(2)}` },
                    { key: "orders", label: "Orders", align: "right", sortable: true },
                    { key: "cvr", label: "CVR", align: "right", sortable: true, render: (val) => `${(val ?? 0).toFixed(1)}%` },
                    { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val ?? 0} /> },
                    { key: "currentBid", label: "Current Bid", align: "right", sortable: true, render: (val) => `€${(val ?? 0).toFixed(2)}` },
                    { key: "recommendedBid", label: "New Bid", align: "right", sortable: true, render: (val) => val != null ? `€${val.toFixed(2)}` : "-" },
                    { key: "bidChange", label: "Change", align: "right", sortable: true, render: (val, row) => {
                      if (val == null || row.action === 'maintain') return <span className="text-muted-foreground">-</span>;
                      const isIncrease = row.action === 'increase';
                      const isDecrease = row.action === 'decrease';
                      return (
                        <span className={isIncrease ? "text-green-600 dark:text-green-400" : isDecrease ? "text-red-600 dark:text-red-400" : ""}>
                          {val > 0 ? "+" : ""}{val.toFixed(1)}%
                        </span>
                      );
                    }},
                    { key: "confidence", label: "Confidence", align: "center", sortable: true, render: (val) => {
                      if (!val) return "-";
                      const colors: Record<string, string> = {
                        'Extreme': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
                        'High': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                        'Good': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
                        'OK': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                        'Low': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                      };
                      return <Badge className={colors[val] || ''}>{val}</Badge>;
                    }},
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
                      key={rec.targeting} 
                      targeting={rec.targeting}
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
        </div>
      </main>
    </div>
  );
}
