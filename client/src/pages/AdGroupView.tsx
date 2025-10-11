import KPICard from "@/components/KPICard";
import TimeRangePicker from "@/components/TimeRangePicker";
import DataTable from "@/components/DataTable";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import FilterChip from "@/components/FilterChip";
import ThemeToggle from "@/components/ThemeToggle";
import ACOSBadge from "@/components/ACOSBadge";
import RecommendationCard from "@/components/RecommendationCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Sparkles } from "lucide-react";
import { useRoute } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

//todo: remove mock functionality
const mockKPIs = [
  { label: "Ad Sales", value: "9,342", currency: "€", trend: { value: 12.5, direction: "up" as const } },
  { label: "ACOS", value: "20.1%", trend: { value: 2.1, direction: "down" as const } },
  { label: "CPC", value: "1.52", currency: "€", trend: { value: 0, direction: "flat" as const } },
  { label: "Cost", value: "1,876", currency: "€", trend: { value: 8.1, direction: "up" as const } },
  { label: "CVR", value: "27.7%", trend: { value: 3.2, direction: "up" as const } },
  { label: "Orders", value: "342", trend: { value: 11.2, direction: "up" as const } },
];

const mockSearchTerms = [
  { searchTerm: "wireless headphones", matchType: "Exact", clicks: 342, cost: 518.34, sales: 2145.67, orders: 87, cpc: 1.52, cvr: 25.4, acos: 24.1, currentBid: 1.50 },
  { searchTerm: "bluetooth headphones", matchType: "Phrase", clicks: 189, cost: 287.45, sales: 1876.32, orders: 62, cpc: 1.52, cvr: 32.8, acos: 15.3, currentBid: 1.45 },
  { searchTerm: "noise cancelling", matchType: "Broad", clicks: 156, cost: 234.12, sales: 987.45, orders: 34, cpc: 1.50, cvr: 21.8, acos: 23.7, currentBid: 1.60 },
  { searchTerm: "over ear headphones", matchType: "Exact", clicks: 98, cost: 147.89, sales: 1234.56, orders: 45, cpc: 1.51, cvr: 45.9, acos: 12.0, currentBid: 1.35 },
];

const mockPlacements = [
  { placement: "Top of Search", clicks: 456, cost: 789.23, sales: 4123.45, acos: 19.1 },
  { placement: "Rest of Search", clicks: 234, cost: 387.65, sales: 1876.32, acos: 20.7 },
  { placement: "Product Pages", clicks: 544, cost: 699.57, sales: 3342.44, acos: 20.9 },
];

const mockRecommendations = [
  {
    searchTerm: "wireless headphones",
    currentBid: 1.50,
    proposedBid: 1.20,
    clicks: 342,
    acos: 24.1,
    target: 20,
    rationale: "ACOS above target (24.1% vs 20%). Reducing bid by 20% to improve efficiency while maintaining visibility.",
  },
  {
    searchTerm: "over ear headphones",
    currentBid: 1.35,
    proposedBid: 1.62,
    clicks: 98,
    acos: 12.0,
    target: 20,
    rationale: "ACOS well below target (12% vs 20%). Opportunity to increase bid by 20% to capture more volume.",
  },
];

export default function AdGroupView() {
  const [, params] = useRoute("/ad-group/:id");
  const [showRecommendations, setShowRecommendations] = useState(false);
  const adGroupId = params?.id || "ag1";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold" data-testid="brand-logo">Elan</h1>
            <BreadcrumbNav items={[
              { label: "Dashboard", href: "/" },
              { label: "France", href: "/country/FR" },
              { label: "Summer Sale 2024", href: "/campaign/c1" },
              { label: "Premium Headphones" }
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
            <FilterChip label="Ad Group" value="Premium Headphones" />
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {mockKPIs.map((kpi) => (
            <KPICard key={kpi.label} {...kpi} />
          ))}
        </div>

        <Tabs defaultValue="search-terms" className="space-y-6">
          <TabsList>
            <TabsTrigger value="search-terms" data-testid="tab-search-terms">Search Terms</TabsTrigger>
            <TabsTrigger value="placements" data-testid="tab-placements">Placements</TabsTrigger>
          </TabsList>

          <TabsContent value="search-terms" className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Search Terms</h2>
                  <p className="text-sm text-muted-foreground">Performance by search term with bid recommendations</p>
                </div>
                <Button 
                  className="gap-2" 
                  onClick={() => setShowRecommendations(!showRecommendations)}
                  data-testid="button-generate-recommendations"
                >
                  <Sparkles className="h-4 w-4" />
                  {showRecommendations ? "Hide" : "Generate"} Recommendations
                </Button>
              </div>
              
              <DataTable
                columns={[
                  { key: "searchTerm", label: "Search Term", sortable: true },
                  { key: "matchType", label: "Match Type", sortable: true, render: (val) => <Badge variant="outline">{val}</Badge> },
                  { key: "clicks", label: "Clicks", align: "right", sortable: true },
                  { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                  { key: "orders", label: "Orders", align: "right", sortable: true },
                  { key: "cpc", label: "CPC", align: "right", sortable: true, render: (val) => `€${val.toFixed(2)}` },
                  { key: "cvr", label: "CVR", align: "right", sortable: true, render: (val) => `${val.toFixed(1)}%` },
                  { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
                  { key: "currentBid", label: "Current Bid", align: "right", sortable: true, render: (val) => `€${val.toFixed(2)}` },
                ]}
                data={mockSearchTerms}
              />
            </div>

            {showRecommendations && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Bid Recommendations</h3>
                  <p className="text-sm text-muted-foreground">Targeting 20% ACOS - {mockRecommendations.length} recommendations generated</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mockRecommendations.map((rec) => (
                    <RecommendationCard key={rec.searchTerm} {...rec} currency="€" />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="placements" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Placement Performance</h2>
              <p className="text-sm text-muted-foreground">Top of Search (TOS) vs Rest of Search (ROS) vs Product Pages (PP)</p>
            </div>
            <DataTable
              columns={[
                { key: "placement", label: "Placement", sortable: true },
                { key: "clicks", label: "Clicks", align: "right", sortable: true },
                { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
                { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
              ]}
              data={mockPlacements}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
