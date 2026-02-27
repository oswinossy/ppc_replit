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
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Download, TrendingUp, Target, Info, Clock, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { authFetch } from "@/lib/queryClient";
import { useSearchParams } from "@/hooks/useSearchParams";

type ViewMode = 'search-terms' | 'placements';

export default function CampaignView() {
  const [, params] = useRoute("/campaign/:id");
  const [, setLocation] = useLocation();
  const { user, signOut } = useAuth();
  const campaignId = params?.id || "";
  
  // Extract country, campaignType, and view from query parameters
  const searchParams = useSearchParams();
  const countryCode = searchParams.country;
  const campaignType = searchParams.campaignType;
  const initialView = searchParams.get('view') as ViewMode;
  
  // Get display name for campaign type
  const campaignTypeLabel = campaignType === 'brands' ? 'Sponsored Brands' : 
                            campaignType === 'display' ? 'Display' : 'Sponsored Products';
  
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const to = new Date();
    const from = subDays(to, 59);
    return {
      from: format(from, 'yyyy-MM-dd'),
      to: format(to, 'yyyy-MM-dd'),
    };
  });
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
      const response = await authFetch(`/api/kpis?${params}`);
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
      const response = await authFetch(`/api/ad-groups?${params}`);
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
      const response = await authFetch(`/api/campaign-placements?${params}`);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
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
      const response = await authFetch(`/api/chart-data?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  // Campaign-level T0 data (since last bid/placement change in campaign)
  const { data: campaignT0, isLoading: t0Loading } = useQuery({
    queryKey: ['/api/campaign-t0', campaignId, countryCode, campaignType],
    queryFn: async () => {
      const params = new URLSearchParams({ campaignId });
      if (countryCode) params.append('country', countryCode);
      if (campaignType) params.append('campaignType', campaignType === 'brands' ? 'SB' : 'SP');
      const response = await authFetch(`/api/campaign-t0?${params}`);
      return response.json();
    },
    enabled: !!countryCode && campaignType !== 'display',
    refetchInterval: 3600000,
  });

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({
      campaignId,
      from: dateRange.from,
      to: dateRange.to,
      campaignType
    });
    const response = await authFetch(`/api/exports/negatives.xlsx?${params}`);
    if (!response.ok) {
      alert('Export failed. Please try again.');
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `negative-keywords-${campaignId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExportRecommendations = async () => {
    const params = new URLSearchParams({
      campaignId
    });
    if (countryCode) {
      params.append('country', countryCode);
    }
    const response = await authFetch(`/api/exports/bid-recommendations.xlsx?${params}`);
    if (!response.ok) {
      alert('Export failed. Please try again.');
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bid-recommendations-${campaignId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-sm">{user?.email?.[0]?.toUpperCase() ?? "U"}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal text-sm text-muted-foreground">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

        {/* Campaign T0 Section - shows performance since last bid/placement change */}
        {campaignType !== 'display' && (
          t0Loading ? (
            <Skeleton className="h-28" />
          ) : campaignT0 && !campaignT0.error ? (
            <Card className="border-dashed">
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Campaign T0</span>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Performance since the last keyword bid or placement adjustment change in this campaign
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaignT0.campaignT0Date ? (
                      <>
                        <Badge variant="outline" className="font-mono text-xs">
                          T0: {campaignT0.campaignT0Date}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {campaignT0.daysSinceT0} days ago
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs">No bid changes</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-xl font-bold">
                      {campaignT0.t0_acos != null ? `${campaignT0.t0_acos.toFixed(1)}%` : '--'}
                    </div>
                    <div className="text-xs text-muted-foreground">T0 ACOS</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-xl font-bold">
                      {(kpis?.currency === 'EUR' ? '\u20AC' : kpis?.currency || '\u20AC')}{campaignT0.t0_sales?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0'}
                    </div>
                    <div className="text-xs text-muted-foreground">T0 Sales</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-xl font-bold">
                      {(kpis?.currency === 'EUR' ? '\u20AC' : kpis?.currency || '\u20AC')}{campaignT0.t0_cost?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0'}
                    </div>
                    <div className="text-xs text-muted-foreground">T0 Cost</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-xl font-bold">
                      {campaignT0.t0_roas != null ? campaignT0.t0_roas.toFixed(2) : '--'}
                    </div>
                    <div className="text-xs text-muted-foreground">T0 ROAS</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null
        )}

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
            ) : placements?.placements?.length > 0 ? (
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
            ) : (
              <div className="border rounded-lg py-12 text-center text-muted-foreground">
                <Info className="h-8 w-8 mx-auto mb-3" />
                <p className="font-medium">No placement data available</p>
                <p className="text-sm mt-1">
                  No placement data was found for this campaign in the selected date range.
                  Try selecting a different time period.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
