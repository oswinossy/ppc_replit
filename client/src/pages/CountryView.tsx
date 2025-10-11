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

const mockCampaigns = [
  { id: "c1", campaign: "Summer Sale 2024", clicks: 1234, cost: 1876.45, sales: 9342.21, acos: 20.1, orders: 342 },
  { id: "c2", campaign: "Brand Awareness Q4", clicks: 856, cost: 1432.12, sales: 7854.33, acos: 18.2, orders: 278 },
  { id: "c3", campaign: "Holiday Promo", clicks: 2341, cost: 3124.89, sales: 14232.45, acos: 22.0, orders: 512 },
  { id: "c4", campaign: "Product Launch", clicks: 803, cost: 2273.99, sales: 16403.22, acos: 13.9, orders: 102 },
];

export default function CountryView() {
  const [, params] = useRoute("/country/:code");
  const [, setLocation] = useLocation();
  const countryCode = params?.code || "FR";
  const countryName = countryCode === "FR" ? "France" : countryCode === "DE" ? "Germany" : countryCode;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <BreadcrumbNav items={[
              { label: "Dashboard", href: "/" },
              { label: countryName }
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
            <FilterChip label="Country" value={countryName} />
            <FilterChip label="Period" value="Last 60 days" />
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
              <h2 className="text-xl font-semibold">Campaigns</h2>
              <p className="text-sm text-muted-foreground">Click a campaign to view ad groups</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-recommendations">
              <TrendingUp className="h-4 w-4" />
              Generate Recommendations
            </Button>
          </div>
          <DataTable
            columns={[
              { key: "campaign", label: "Campaign", sortable: true },
              { key: "clicks", label: "Clicks", align: "right", sortable: true },
              { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
              { key: "orders", label: "Orders", align: "right", sortable: true },
              { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
            ]}
            data={mockCampaigns}
            onRowClick={(row) => {
              console.log('Navigate to campaign:', row.id);
              setLocation(`/campaign/${row.id}`);
            }}
          />
        </div>
      </main>
    </div>
  );
}
