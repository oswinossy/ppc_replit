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

//todo: remove mock functionality
const mockKPIs = [
  { label: "Ad Sales", value: "9,342", currency: "€", trend: { value: 12.5, direction: "up" as const } },
  { label: "ACOS", value: "20.1%", trend: { value: 2.1, direction: "down" as const } },
  { label: "CPC", value: "1.52", currency: "€", trend: { value: 0, direction: "flat" as const } },
  { label: "Cost", value: "1,876", currency: "€", trend: { value: 8.1, direction: "up" as const } },
  { label: "ROAS", value: "4.98", trend: { value: 15.3, direction: "up" as const } },
  { label: "Orders", value: "342", trend: { value: 11.2, direction: "up" as const } },
];

const mockChartData = [
  { date: "Oct 1", acos: 24.5, sales: 850 },
  { date: "Oct 8", acos: 21.8, sales: 980 },
  { date: "Oct 15", acos: 20.1, sales: 1120 },
  { date: "Oct 22", acos: 22.3, sales: 890 },
  { date: "Oct 29", acos: 19.5, sales: 1280 },
  { date: "Nov 5", acos: 18.8, sales: 1420 },
  { date: "Nov 12", acos: 20.9, sales: 1050 },
];

const mockAdGroups = [
  { id: "ag1", adGroup: "Premium Headphones", clicks: 785, cost: 1187.45, sales: 5893.21, acos: 20.1, orders: 215 },
  { id: "ag2", adGroup: "Budget Audio", clicks: 234, cost: 356.78, sales: 1432.89, acos: 24.9, orders: 67 },
  { id: "ag3", adGroup: "Wireless Speakers", clicks: 215, cost: 332.22, sales: 2016.11, acos: 16.5, orders: 60 },
];

export default function CampaignView() {
  const [, params] = useRoute("/campaign/:id");
  const [, setLocation] = useLocation();
  const campaignId = params?.id || "c1";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <BreadcrumbNav items={[
              { label: "Dashboard", href: "/" },
              { label: "France", href: "/country/FR" },
              { label: "Summer Sale 2024" }
            ]} />
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
            <FilterChip label="Country" value="France" />
            <FilterChip label="Campaign" value="Summer Sale 2024" />
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
              <h2 className="text-xl font-semibold">Ad Groups</h2>
              <p className="text-sm text-muted-foreground">Click an ad group to view search terms</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-recommendations">
              <TrendingUp className="h-4 w-4" />
              Generate Recommendations
            </Button>
          </div>
          <DataTable
            columns={[
              { key: "adGroup", label: "Ad Group", sortable: true },
              { key: "clicks", label: "Clicks", align: "right", sortable: true },
              { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "orders", label: "Orders", align: "right", sortable: true },
              { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
            ]}
            data={mockAdGroups}
            onRowClick={(row) => {
              console.log('Navigate to ad group:', row.id);
              setLocation(`/ad-group/${row.id}`);
            }}
          />
        </div>
      </main>
    </div>
  );
}
