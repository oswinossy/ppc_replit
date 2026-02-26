import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import PerformanceChart from "@/components/PerformanceChart";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import { AgentChat } from "@/components/AgentChat";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, TrendingUp, Globe, Target, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { authFetch } from "@/lib/queryClient";
import { format, subDays, differenceInDays, parseISO } from "date-fns";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, signOut } = useAuth();
  // Initialize with last 60 days to load data immediately
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const to = new Date();
    const from = subDays(to, 59);
    return {
      from: format(from, 'yyyy-MM-dd'),
      to: format(to, 'yyyy-MM-dd'),
    };
  });
  const [campaignType, setCampaignType] = useState<'products' | 'brands' | 'display'>('products');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');

  // Single combined API call for all dashboard data - much faster than 4 separate calls
  const { data: dashboardData, isLoading: dashboardLoading, error: dashboardError } = useQuery({
    queryKey: ['/api/dashboard', dateRange, campaignType, selectedCountry],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        from: dateRange.from, 
        to: dateRange.to,
        campaignType
      });
      if (selectedCountry !== 'all') {
        params.set('country', selectedCountry);
      }
      const response = await authFetch(`/api/dashboard?${params}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    refetchInterval: 3600000, // Auto-refresh every hour
  });

  // Separate query for available countries (always all countries, unfiltered)
  const { data: availableCountries } = useQuery({
    queryKey: ['/api/countries', dateRange, campaignType, 'dropdown'],
    queryFn: async () => {
      const params = new URLSearchParams({ 
        from: dateRange.from, 
        to: dateRange.to,
        campaignType 
      });
      const response = await authFetch(`/api/countries?${params}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Extract data from combined response
  const kpis = dashboardData?.kpis;
  const kpisLoading = dashboardLoading;
  const chartData = dashboardData?.chartData;
  const chartLoading = dashboardLoading;
  const chartError = dashboardError;
  
  // Countries: filter if specific country selected, otherwise show all
  const countries = selectedCountry !== 'all' 
    ? dashboardData?.countries?.filter((c: any) => c.code === selectedCountry)
    : dashboardData?.countries;
  const countriesLoading = dashboardLoading;
  const countriesError = dashboardError;

  const handleExportNegatives = async () => {
    const params = new URLSearchParams({ 
      from: dateRange.from, 
      to: dateRange.to,
      campaignType 
    });
    if (selectedCountry !== 'all') {
      params.set('country', selectedCountry);
    }
    const response = await authFetch(`/api/exports/negatives.xlsx?${params}`);
    if (!response.ok) {
      alert('Export failed. Please try again.');
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'negative-keywords.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const getPeriodLabel = () => {
    if (!dateRange) return "Last 60 days";
    
    const days = differenceInDays(parseISO(dateRange.to), parseISO(dateRange.from)) + 1;
    
    // Check if it's a standard period
    if (days === 14) return "Last 14 days";
    if (days === 30) return "Last 30 days";
    if (days === 60) return "Last 60 days";
    if (days === 365) return "Last 365 days";
    
    // Check if it's lifetime (starts from Oct 1, 2024)
    if (dateRange.from === '2024-10-01') return "Lifetime";
    
    // Custom period
    return `${format(parseISO(dateRange.from), 'MMM dd')} - ${format(parseISO(dateRange.to), 'MMM dd, yyyy')}`;
  };

  const handleClearFilters = () => {
    const to = new Date();
    const from = subDays(to, 59);
    setDateRange({
      from: format(from, 'yyyy-MM-dd'),
      to: format(to, 'yyyy-MM-dd'),
    });
    setSelectedCountry('all');
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
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg border-2 border-primary">
              <button
                onClick={() => setCampaignType('products')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  campaignType === 'products' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-background'
                }`}
                data-testid="tab-campaign-products"
              >
                Products
              </button>
              <button
                onClick={() => setCampaignType('brands')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  campaignType === 'brands' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-background'
                }`}
                data-testid="tab-campaign-brands"
              >
                Brands
              </button>
              <button
                onClick={() => setCampaignType('display')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  campaignType === 'display' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-background'
                }`}
                data-testid="tab-campaign-display"
              >
                Display
              </button>
            </div>
            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
              <SelectTrigger className="w-[180px]" data-testid="select-country">
                <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All Countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-country-all">All Countries</SelectItem>
                {availableCountries && Array.isArray(availableCountries) && availableCountries.map((country: any) => (
                  <SelectItem 
                    key={country.code} 
                    value={country.code}
                    data-testid={`option-country-${country.code}`}
                  >
                    {country.country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <BreadcrumbNav items={[{ label: "Dashboard" }]} />
          </div>
          <div className="flex items-center gap-4">
            <Link href="/bidding-strategy">
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2" 
                data-testid="button-bidding-strategy"
              >
                <Target className="h-4 w-4" />
                Bidding Strategy
              </Button>
            </Link>
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
            <FilterChip label="Period" value={getPeriodLabel()} />
            {selectedCountry !== 'all' && (
              <FilterChip 
                label="Country" 
                value={availableCountries?.find((c: any) => c.code === selectedCountry)?.country || selectedCountry} 
              />
            )}
            <button 
              className="text-sm text-primary hover:underline" 
              onClick={handleClearFilters}
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
                <h3 className="text-lg font-semibold">Connection Error</h3>
                <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                  Unable to load data from the database. This may be a temporary issue.
                </p>
              </div>
              <div className="bg-muted p-4 rounded-md text-left max-w-xl mx-auto">
                <code className="text-sm font-mono text-destructive">
                  {countriesError instanceof Error ? countriesError.message : 'Unknown error occurred'}
                </code>
              </div>
              <Button 
                variant="outline" 
                onClick={() => window.location.reload()}
                data-testid="button-retry"
              >
                Retry
              </Button>
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
                setLocation(`/country/${row.code}?campaignType=${campaignType}`);
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
