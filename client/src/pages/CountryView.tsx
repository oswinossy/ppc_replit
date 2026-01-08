import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import PerformanceChart from "@/components/PerformanceChart";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import CurrencyBadge from "@/components/CurrencyBadge";
import { Button } from "@/components/ui/button";
import { Download, TrendingUp } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParams } from "@/hooks/useSearchParams";

export default function CountryView() {
  const [, params] = useRoute("/country/:code");
  const [, setLocation] = useLocation();
  const countryCode = params?.code || "FR";
  const { campaignType } = useSearchParams();
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['/api/kpis', countryCode, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        country: countryCode,
        from: dateRange.from, 
        to: dateRange.to,
        campaignType,
        convertToEur: 'false' // Display in local currency for country-specific views
      });
      const response = await fetch(`/api/kpis?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['/api/campaigns', countryCode, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        country: countryCode,
        from: dateRange.from, 
        to: dateRange.to,
        campaignType,
        convertToEur: 'false' // Display in local currency for country-specific views
      });
      const response = await fetch(`/api/campaigns?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['/api/chart-data', countryCode, campaignType, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        country: countryCode,
        from: dateRange.from, 
        to: dateRange.to,
        grain: 'weekly',
        campaignType,
        convertToEur: 'false' // Display in local currency for country-specific views
      });
      const response = await fetch(`/api/chart-data?${params}`);
      return response.json();
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ 
      country: countryCode,
      from: dateRange.from, 
      to: dateRange.to,
      campaignType
    });
    window.open(`/api/exports/negatives.xlsx?${params}`, '_blank');
  };

  const handleExportRecommendations = async () => {
    const params = new URLSearchParams({ 
      country: countryCode,
      from: dateRange.from, 
      to: dateRange.to
    });
    window.open(`/api/exports/recommendations.csv?${params}`, '_blank');
  };
  
  // Get display name for campaign type
  const campaignTypeLabel = campaignType === 'brands' ? 'Sponsored Brands' : 
                            campaignType === 'display' ? 'Display' : 'Sponsored Products';

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
              { label: `${countryCode} (${campaignTypeLabel})` }
            ]} />
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
          <TimeRangePicker value={dateRange} onChange={setDateRange} />
          <div className="flex items-center gap-2">
            <FilterChip label="Country" value={countryCode} />
            <FilterChip label="Period" value="Last 60 days" />
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

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Campaigns</h2>
              <p className="text-sm text-muted-foreground">Click a campaign to view ad groups</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-recommendations">
              <TrendingUp className="h-4 w-4" />
              Generate Recommendations
            </Button>
          </div>
          {campaignsLoading ? (
            <Skeleton className="h-64" />
          ) : campaigns ? (
            <DataTable
              columns={[
                { key: "campaign", label: "Campaign", sortable: true },
                { key: "clicks", label: "Clicks", align: "right", sortable: true },
                { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "orders", label: "Orders", align: "right", sortable: true },
                { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
              ]}
              data={campaigns}
              onRowClick={(row) => {
                setLocation(`/campaign/${row.id}?country=${countryCode}&campaignType=${campaignType}`);
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
