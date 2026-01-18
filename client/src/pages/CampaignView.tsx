import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import PerformanceChart from "@/components/PerformanceChart";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import CurrencyBadge from "@/components/CurrencyBadge";
import { AgentChat } from "@/components/AgentChat";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp, Target } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useSearchParams } from "@/hooks/useSearchParams";

type ViewMode = 'search-terms' | 'placements';

export default function CampaignView() {
  const [, params] = useRoute("/campaign/:id");
  const [, setLocation] = useLocation();
  const campaignId = params?.id || "";
  
  // Extract country, campaignType, and view from query parameters
  const searchParams = useSearchParams();
  const countryCode = searchParams.country;
  const campaignType = searchParams.campaignType;
  const initialView = searchParams.get('view') as ViewMode;
  
  // Get display name for campaign type
  const campaignTypeLabel = campaignType === 'brands' ? 'Sponsored Brands' : 
                            campaignType === 'display' ? 'Display' : 'Sponsored Products';
  
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });
  const [viewMode, setViewMode] = useState<ViewMode>(initialView === 'placements' ? 'placements' : 'search-terms');
  
  // Auto-switch to placements view if URL has view=placements
  useEffect(() => {
    if (initialView === 'placements' && viewMode !== 'placements') {
      setViewMode('placements');
    }
  }, [initialView]);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['/api/kpis', campaignId, countryCode, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        from: dateRange.from, 
        to: dateRange.to,
        campaignType
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

  const { data: adGroups, isLoading: adGroupsLoading } = useQuery({
    queryKey: ['/api/ad-groups', campaignId, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        from: dateRange.from, 
        to: dateRange.to,
        campaignType
      });
      const response = await fetch(`/api/ad-groups?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const { data: placements, isLoading: placementsLoading } = useQuery({
    queryKey: ['/api/campaign-placements', campaignId, campaignType, dateRange],
    enabled: viewMode === 'placements',
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        from: dateRange.from, 
        to: dateRange.to,
        campaignType
      });
      const response = await fetch(`/api/campaign-placements?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const { data: chartData, isLoading: chartLoading} = useQuery({
    queryKey: ['/api/chart-data', campaignId, countryCode, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        from: dateRange.from, 
        to: dateRange.to,
        grain: 'weekly',
        campaignType
      });
      // When country is present, display in local currency
      if (countryCode) {
        params.append('country', countryCode);
        params.append('convertToEur', 'false');
      }
      const response = await fetch(`/api/chart-data?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ 
      campaignId,
      from: dateRange.from, 
      to: dateRange.to,
      campaignType
    });
    window.open(`/api/exports/negatives.xlsx?${params}`, '_blank');
  };

  const handleExportRecommendations = async () => {
    const params = new URLSearchParams({ 
      campaignId,
      from: dateRange.from, 
      to: dateRange.to
    });
    if (countryCode) {
      params.append('country', countryCode);
    }
    window.open(`/api/exports/recommendations.csv?${params}`, '_blank');
  };

  const kpiCards = (kpis && !kpis.error) ? [
    { label: "Ad Sales", value: kpis.adSales?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "ACOS", value: `${kpis.acos?.toFixed(1) || '0'}%` },
    { label: "CPC", value: kpis.cpc?.toFixed(2) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "Cost", value: kpis.cost?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0', currency: kpis.currency === 'EUR' ? '€' : kpis.currency },
    { label: "ROAS", value: kpis.roas?.toFixed(2) || '0' },
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
              { label: `Campaign (${campaignTypeLabel})` }
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
              Export Bid Recommendations
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
            <FilterChip label="Campaign" value={campaignId} />
          </div>
        </div>
      </div>

      <div className="border-b bg-background">
        <div className="flex items-center justify-end px-6 py-3">
          <div className="flex items-center gap-2">
            <Badge 
              variant={viewMode === 'search-terms' ? 'default' : 'outline'}
              className="cursor-pointer hover-elevate active-elevate-2"
              onClick={() => setViewMode('search-terms')}
              data-testid="badge-view-search-terms"
            >
              Search Terms
            </Badge>
            <Badge 
              variant={viewMode === 'placements' ? 'default' : 'outline'}
              className="cursor-pointer hover-elevate active-elevate-2"
              onClick={() => setViewMode('placements')}
              data-testid="badge-view-placements"
            >
              Placements
            </Badge>
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

        {chartLoading ? (
          <Skeleton className="h-80" />
        ) : chartData ? (
          <PerformanceChart data={chartData} currency={kpis?.currency === 'EUR' ? '€' : kpis?.currency || '€'} />
        ) : null}

        {viewMode === 'search-terms' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Ad Groups</h2>
                <p className="text-sm text-muted-foreground">Click an ad group to view search terms</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-recommendations">
                <TrendingUp className="h-4 w-4" />
                Generate Recommendations
              </Button>
            </div>
            {adGroupsLoading ? (
              <Skeleton className="h-64" />
            ) : adGroups ? (
              <DataTable
                columns={[
                  { key: "adGroup", label: "Ad Group", sortable: true },
                  { key: "clicks", label: "Clicks", align: "right", sortable: true },
                  { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "orders", label: "Orders", align: "right", sortable: true },
                  { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                ]}
                data={adGroups}
                onRowClick={(row) => {
                  const url = countryCode 
                    ? `/ad-group/${row.id}?country=${countryCode}&campaignType=${campaignType}&campaignId=${campaignId}`
                    : `/ad-group/${row.id}?campaignType=${campaignType}&campaignId=${campaignId}`;
                  setLocation(url);
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">Placements</h2>
                <p className="text-sm text-muted-foreground">Campaign-level placement performance and bid adjustments</p>
              </div>
              <div className="flex items-center gap-2">
                {placements?.hasKeywordRecs && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={`/bidding-strategy?country=${countryCode || ''}`}>
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 cursor-pointer hover-elevate">
                          <Target className="h-3 w-3 mr-1" />
                          {placements.keywordRecCount} Keyword Adjustments
                        </Badge>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This campaign also has {placements.keywordRecCount} keyword bid recommendations.</p>
                      <p className="text-muted-foreground text-xs mt-1">Click to view Bidding Strategy</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const url = `/api/exports/campaign-placements.xlsx?campaignId=${campaignId}${countryCode ? `&country=${countryCode}` : ''}`;
                    const a = document.createElement("a");
                    a.href = url;
                    a.click();
                  }}
                  disabled={!placements?.placements?.length}
                  data-testid="button-export-placements"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </div>
            </div>
            {placementsLoading ? (
              <Skeleton className="h-64" />
            ) : placements?.placements ? (
              <DataTable
                columns={[
                  { key: "placement", label: "Placement", sortable: true },
                  { key: "biddingStrategy", label: "Campaign Bidding Strategy", sortable: true },
                  { key: "bidAdjustment", label: "Bid Adjustment", align: "right", sortable: true, render: (val) => {
                    if (val === null || val === undefined) return '-';
                    const adjustment = Number(val);
                    return `${adjustment}%`;
                  }},
                  { key: "impressions", label: "Impressions", align: "right", sortable: true, render: (val) => Number(val ?? 0).toLocaleString() },
                  { key: "clicks", label: "Clicks", align: "right", sortable: true, render: (val) => Number(val ?? 0).toLocaleString() },
                  { key: "ctr", label: "CTR", align: "right", sortable: true, render: (val) => `${Number(val ?? 0).toFixed(2)}%` },
                  { key: "spend", label: "Spend", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "cpc", label: "CPC", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "orders", label: "Orders", align: "right", sortable: true },
                  { key: "sales", label: "Sales", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                  { 
                    key: "targetBidAdjustment", 
                    label: "Target Bid Adjustment", 
                    align: "right", 
                    sortable: true,
                    cellClassName: (val, row) => {
                      if (val === null || val === undefined) return "text-muted-foreground";
                      const target = Number(val);
                      const current = Number(row?.bidAdjustment ?? 0);
                      if (target === current) return "text-muted-foreground";
                      if (target > current) return "font-semibold text-green-600 dark:text-green-400";
                      return "font-semibold text-red-600 dark:text-red-400";
                    },
                    render: (val) => {
                      if (val === null || val === undefined) return "-";
                      return `${val}%`;
                    }
                  },
                ]}
                data={placements.placements}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
