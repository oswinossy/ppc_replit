import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import PerformanceChart from "@/components/PerformanceChart";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

type CampaignType = 'products' | 'brands' | 'display';
type ViewMode = 'search-terms' | 'placements';

export default function CampaignView() {
  const [, params] = useRoute("/campaign/:id");
  const [, setLocation] = useLocation();
  const campaignId = params?.id || "";
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });
  const [campaignType, setCampaignType] = useState<CampaignType>('products');
  const [viewMode, setViewMode] = useState<ViewMode>('search-terms');

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['/api/kpis', campaignId, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        campaignType,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/kpis?${params}`);
      return response.json();
    },
  });

  const { data: adGroups, isLoading: adGroupsLoading } = useQuery({
    queryKey: ['/api/ad-groups', campaignId, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        campaignType,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/ad-groups?${params}`);
      return response.json();
    },
  });

  const { data: placements, isLoading: placementsLoading } = useQuery({
    queryKey: ['/api/campaign-placements', campaignId, dateRange],
    enabled: campaignType === 'products' && viewMode === 'placements',
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        from: dateRange.from, 
        to: dateRange.to 
      });
      const response = await fetch(`/api/campaign-placements?${params}`);
      return response.json();
    },
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['/api/chart-data', campaignId, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        campaignId,
        campaignType,
        from: dateRange.from, 
        to: dateRange.to,
        grain: 'weekly'
      });
      const response = await fetch(`/api/chart-data?${params}`);
      return response.json();
    },
  });

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ 
      campaignId,
      campaignType,
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
              { label: "Dashboard", href: "/" },
              { label: "Campaign" }
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
            <FilterChip label="Campaign" value={campaignId} />
          </div>
        </div>
      </div>

      <div className="border-b bg-background">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <Badge 
              variant={campaignType === 'products' ? 'default' : 'outline'}
              className="cursor-pointer hover-elevate active-elevate-2"
              onClick={() => {
                setCampaignType('products');
                setViewMode('search-terms');
              }}
              data-testid="badge-campaign-type-products"
            >
              Sponsored Products
            </Badge>
            <Badge 
              variant={campaignType === 'brands' ? 'default' : 'outline'}
              className="cursor-pointer hover-elevate active-elevate-2"
              onClick={() => {
                setCampaignType('brands');
                setViewMode('search-terms');
              }}
              data-testid="badge-campaign-type-brands"
            >
              Sponsored Brands
            </Badge>
            <Badge 
              variant={campaignType === 'display' ? 'default' : 'outline'}
              className="cursor-pointer hover-elevate active-elevate-2"
              onClick={() => {
                setCampaignType('display');
                setViewMode('search-terms');
              }}
              data-testid="badge-campaign-type-display"
            >
              Display
            </Badge>
          </div>
          {campaignType === 'products' && (
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
          )}
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
                  setLocation(`/ad-group/${row.id}`);
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Placements</h2>
                <p className="text-sm text-muted-foreground">Campaign-level placement performance and bid adjustments</p>
              </div>
            </div>
            {placementsLoading ? (
              <Skeleton className="h-64" />
            ) : placements ? (
              <DataTable
                columns={[
                  { key: "placement", label: "Placement", sortable: true },
                  { key: "clicks", label: "Clicks", align: "right", sortable: true },
                  { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "orders", label: "Orders", align: "right", sortable: true },
                  { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                  { key: "cpc", label: "CPC (€)", align: "right", sortable: true, render: (val) => `€${Number(val ?? 0).toFixed(2)}` },
                  { key: "bidAdjustment", label: "Bid Adjustment", align: "right", sortable: true, render: (val) => {
                    const adjustment = Number(val ?? 0);
                    const color = adjustment > 0 ? 'text-green-600 dark:text-green-400' : adjustment < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
                    return <span className={color}>{adjustment > 0 ? '+' : ''}{adjustment.toFixed(0)}%</span>;
                  }},
                ]}
                data={placements}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
