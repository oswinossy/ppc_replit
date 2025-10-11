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

//todo: remove mock functionality
const mockKPIs = [
  { label: "Ad Sales", value: "47,832", currency: "€", trend: { value: 12.5, direction: "up" as const } },
  { label: "ACOS", value: "18.2%", trend: { value: 3.2, direction: "down" as const } },
  { label: "CPC", value: "0.87", currency: "€", trend: { value: 0, direction: "flat" as const } },
  { label: "Cost", value: "8,706", currency: "€", trend: { value: 8.1, direction: "up" as const } },
  { label: "ROAS", value: "5.49", trend: { value: 15.3, direction: "up" as const } },
  { label: "Orders", value: "1,234", trend: { value: 11.2, direction: "up" as const } },
];

const mockChartData = [
  { date: "Oct 1", acos: 22.5, sales: 1250 },
  { date: "Oct 8", acos: 19.8, sales: 1480 },
  { date: "Oct 15", acos: 18.2, sales: 1620 },
  { date: "Oct 22", acos: 21.3, sales: 1390 },
  { date: "Oct 29", acos: 17.5, sales: 1780 },
  { date: "Nov 5", acos: 16.8, sales: 1920 },
  { date: "Nov 12", acos: 18.9, sales: 1650 },
];

const mockCountries = [
  { country: "France", code: "FR", clicks: 5234, cost: 8706.45, sales: 47832.21, acos: 18.2, orders: 1234 },
  { country: "Germany", code: "DE", clicks: 4856, cost: 12432.12, sales: 52854.33, acos: 23.5, orders: 1456 },
  { country: "Spain", code: "ES", clicks: 3341, cost: 6124.89, sales: 28232.45, acos: 21.7, orders: 892 },
  { country: "Italy", code: "IT", clicks: 2987, cost: 5342.67, sales: 24123.78, acos: 22.1, orders: 756 },
];

export default function Dashboard() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <BreadcrumbNav items={[{ label: "Dashboard" }]} />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-export">
              <Download className="h-4 w-4" />
              Export Negatives
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <TimeRangePicker />
          <div className="flex items-center gap-2">
            <FilterChip label="Period" value="Last 60 days" />
            <button className="text-sm text-primary hover:underline" data-testid="button-clear-filters">
              Clear all
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {mockKPIs.map((kpi) => (
            <KPICard key={kpi.label} {...kpi} />
          ))}
        </div>

        <PerformanceChart data={mockChartData} currency="€" />

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
          <DataTable
            columns={[
              { key: "country", label: "Country", sortable: true },
              { key: "clicks", label: "Clicks", align: "right", sortable: true },
              { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "orders", label: "Orders", align: "right", sortable: true },
              { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
            ]}
            data={mockCountries}
            onRowClick={(row) => {
              console.log('Navigate to country:', row.code);
              setLocation(`/country/${row.code}`);
            }}
          />
        </div>
      </main>
    </div>
  );
}
