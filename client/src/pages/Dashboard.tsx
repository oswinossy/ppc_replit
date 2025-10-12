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
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [dateRange, setDateRange] = useState({ from: "2025-09-22", to: "2025-11-22" });

  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useQuery({
    queryKey: ['/api/kpis', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const response = await fetch(`/api/kpis?${params}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });

  const { data: countries, isLoading: countriesLoading, error: countriesError } = useQuery({
    queryKey: ['/api/countries', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const response = await fetch(`/api/countries?${params}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });

  const { data: chartData, isLoading: chartLoading, error: chartError } = useQuery({
    queryKey: ['/api/chart-data', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        from: dateRange.from, 
        to: dateRange.to,
        grain: 'weekly'
      });
      const response = await fetch(`/api/chart-data?${params}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    window.open(`/api/exports/negatives.xlsx?${params}`, '_blank');
  };

  const kpiCards = kpis ? [
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
            <BreadcrumbNav items={[{ label: "Dashboard" }]} />
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
            <FilterChip label="Period" value="Last 60 days" />
            <button 
              className="text-sm text-primary hover:underline" 
              onClick={() => setDateRange({ from: "2025-09-22", to: "2025-11-22" })}
              data-testid="button-clear-filters"
            >
              Clear all
            </button>
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
        ) : chartError ? null : chartData && Array.isArray(chartData) ? (
          <PerformanceChart data={chartData} currency={kpis?.currency === 'EUR' ? '€' : kpis?.currency || '€'} />
        ) : null}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Countries</h2>
              <p className="text-sm text-muted-foreground">Click a country to view campaigns</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-recommendations">
              <TrendingUp className="h-4 w-4" />
              View Recommendations
            </Button>
          </div>
          {countriesLoading ? (
            <Skeleton className="h-64" />
          ) : countriesError ? (
            <div className="border rounded-lg p-8 text-center space-y-4" data-testid="error-message">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Database Setup Required</h3>
                <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                  Your Supabase table name contains hyphens which require a database view. 
                  Please create the view in your Supabase SQL Editor:
                </p>
              </div>
              <div className="bg-muted p-4 rounded-md text-left max-w-3xl mx-auto">
                <code className="text-sm font-mono">
                  CREATE OR REPLACE VIEW vw_sp_search_terms_daily AS<br />
                  SELECT * FROM "sp_search_terms_daily_from22-09-2025";
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                See <code className="bg-muted px-2 py-1 rounded">supabase-setup.sql</code> for the complete setup script
              </p>
            </div>
          ) : countries && Array.isArray(countries) ? (
            <DataTable
              columns={[
                { key: "country", label: "Country", sortable: true },
                { key: "clicks", label: "Clicks", align: "right", sortable: true },
                { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "orders", label: "Orders", align: "right", sortable: true },
                { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
              ]}
              data={countries}
              onRowClick={(row) => {
                setLocation(`/country/${row.code}`);
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
