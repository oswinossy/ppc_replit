import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, Check, Download, ChevronRight, TrendingDown, TrendingUp, Target, Info, Clock, Zap, AlertTriangle, Settings, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

interface BiddingRecommendation {
  type: "keyword_bid" | "placement_adjustment";
  country: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id?: string;
  ad_group_name?: string;
  targeting: string;
  match_type?: string;
  placement?: string;
  current_bid?: number;
  recommended_bid?: number;
  current_adjustment?: number;
  recommended_adjustment?: number;
  change_percent: number;
  action: "increase" | "decrease";
  acos_target: number;
  acos_target_percent: number;
  weighted_acos: number;
  weighted_acos_percent: number;
  t0_acos: number | null;
  t0_clicks: number;
  d30_acos: number | null;
  d30_clicks: number;
  d365_acos: number | null;
  d365_clicks: number;
  lifetime_acos: number | null;
  lifetime_clicks: number;
  confidence: "Extreme" | "High" | "Good" | "OK" | "Low";
  days_since_change: number;
  last_change_date: string | null;
  reason: string;
  hasPlacementRecs?: boolean;
}

interface BiddingStrategyResponse {
  country: string;
  weights: {
    t0_weight: number;
    d30_weight: number;
    d365_weight: number;
    lifetime_weight: number;
  };
  total_recommendations: number;
  recommendations: BiddingRecommendation[];
}

const COUNTRIES = [
  { code: "DE", name: "Germany" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "FR", name: "France" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "PL", name: "Poland" },
  { code: "JP", name: "Japan" },
  { code: "CA", name: "Canada" },
];

const getConfidenceBadgeVariant = (confidence: string) => {
  switch (confidence) {
    case "Extreme": return "default";
    case "High": return "secondary";
    case "Good": return "outline";
    default: return "outline";
  }
};

const getAcosBadgeClass = (acos: number, target: number) => {
  if (acos <= target * 0.8) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (acos <= target) return "bg-green-500/10 text-green-300 border-green-500/20";
  if (acos <= target * 1.2) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
};

const formatAcos = (acos: number | null): string => {
  if (acos === null || acos === 999) return "—";
  return `${(acos * 100).toFixed(1)}%`;
};

const formatCurrency = (value: number, country: string): string => {
  const currencyMap: Record<string, string> = {
    DE: "€", FR: "€", IT: "€", ES: "€",
    US: "$", CA: "$",
    GB: "£",
    SE: "kr",
    PL: "zł",
    JP: "¥",
  };
  return `${currencyMap[country] || "€"}${value.toFixed(2)}`;
};

export default function BiddingStrategy() {
  const [selectedCountry, setSelectedCountry] = useState("DE");
  const [implementDialog, setImplementDialog] = useState<BiddingRecommendation | null>(null);
  const [weightSettingsOpen, setWeightSettingsOpen] = useState(false);
  const [editWeights, setEditWeights] = useState({
    t0: 35,
    d30: 25,
    d365: 25,
    lifetime: 15,
  });
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<BiddingStrategyResponse>({
    queryKey: ["/api/bidding-strategy", selectedCountry],
    queryFn: () => fetch(`/api/bidding-strategy?country=${selectedCountry}`).then(r => r.json()),
    staleTime: 60000,
  });

  const implementMutation = useMutation({
    mutationFn: async (rec: BiddingRecommendation) => {
      return apiRequest("POST", "/api/recommendations/save", {
        recommendation_type: rec.type,
        country: rec.country,
        campaign_id: rec.campaign_id,
        campaign_name: rec.campaign_name,
        ad_group_id: rec.ad_group_id,
        ad_group_name: rec.ad_group_name,
        targeting: rec.targeting,
        match_type: rec.match_type,
        placement: rec.placement || null,
        old_value: rec.type === "keyword_bid" ? rec.current_bid : rec.current_adjustment,
        recommended_value: rec.type === "keyword_bid" ? rec.recommended_bid : rec.recommended_adjustment,
        pre_acos_t0: rec.t0_acos,
        pre_acos_30d: rec.d30_acos,
        pre_acos_365d: rec.d365_acos,
        pre_acos_lifetime: rec.lifetime_acos,
        pre_clicks_t0: rec.t0_clicks,
        pre_clicks_30d: rec.d30_clicks,
        pre_clicks_365d: rec.d365_clicks,
        pre_clicks_lifetime: rec.lifetime_clicks,
        weighted_acos: rec.weighted_acos,
        acos_target: rec.acos_target,
        confidence: rec.confidence,
        reason: rec.reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bidding-strategy"] });
      setImplementDialog(null);
    },
  });

  const updateWeightsMutation = useMutation({
    mutationFn: async (weights: { t0: number; d30: number; d365: number; lifetime: number }) => {
      return apiRequest("POST", `/api/weights/${selectedCountry}`, {
        t0_weight: weights.t0 / 100,
        d30_weight: weights.d30 / 100,
        d365_weight: weights.d365 / 100,
        lifetime_weight: weights.lifetime / 100,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bidding-strategy"] });
      setWeightSettingsOpen(false);
    },
  });

  const handleWeightChange = (key: keyof typeof editWeights, value: string) => {
    const numValue = parseInt(value) || 0;
    setEditWeights(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, numValue)) }));
  };

  const totalWeight = editWeights.t0 + editWeights.d30 + editWeights.d365 + editWeights.lifetime;
  const weightsValid = totalWeight === 100;

  const exportToExcel = () => {
    if (!data?.recommendations) return;
    
    const headers = [
      "Type", "Country", "Campaign", "Ad Group", "Targeting", "Match Type",
      "Current Bid", "Recommended Bid", "Change %", "Action",
      "Target ACOS", "Weighted ACOS", "T0 ACOS", "30D ACOS", "365D ACOS", "Lifetime ACOS",
      "Confidence", "Days Since Change", "Reason"
    ];
    
    const rows = data.recommendations.map(r => [
      r.type,
      r.country,
      r.campaign_name,
      r.ad_group_name || "",
      r.targeting,
      r.match_type || "",
      r.current_bid?.toFixed(2) || "",
      r.recommended_bid?.toFixed(2) || "",
      r.change_percent,
      r.action,
      `${r.acos_target_percent}%`,
      `${r.weighted_acos_percent}%`,
      formatAcos(r.t0_acos),
      formatAcos(r.d30_acos),
      formatAcos(r.d365_acos),
      formatAcos(r.lifetime_acos),
      r.confidence,
      r.days_since_change,
      r.reason
    ]);
    
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bidding-recommendations-${selectedCountry}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const keywordRecs = useMemo(() => 
    data?.recommendations?.filter(r => r.type === "keyword_bid") || [], 
    [data?.recommendations]
  );

  const increaseRecs = keywordRecs.filter(r => r.action === "increase");
  const decreaseRecs = keywordRecs.filter(r => r.action === "decrease");

  const countryInfo = COUNTRIES.find(c => c.code === selectedCountry);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Link href="/" className="hover:text-foreground">Dashboard</Link>
              <ChevronRight className="h-4 w-4" />
              <span>Bidding Strategy</span>
            </div>
            <h1 className="text-2xl font-bold">Bidding Strategy Recommendations</h1>
            <p className="text-muted-foreground mt-1">
              AI-powered bid recommendations based on multi-timeframe ACOS analysis
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
              <SelectTrigger className="w-[180px]" data-testid="select-country">
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => (
                  <SelectItem key={c.code} value={c.code} data-testid={`country-${c.code}`}>
                    <span className="font-medium mr-1">{c.code}</span> {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button 
              variant="outline" 
              onClick={exportToExcel} 
              disabled={!data?.recommendations?.length}
              data-testid="button-export"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {data?.weights && (
          <Card className="bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Weight Configuration</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {countryInfo?.code || "Global"} Weights
                  </Badge>
                  <Dialog open={weightSettingsOpen} onOpenChange={(open) => {
                    setWeightSettingsOpen(open);
                    if (open && data?.weights) {
                      setEditWeights({
                        t0: Math.round(data.weights.t0_weight * 100),
                        d30: Math.round(data.weights.d30_weight * 100),
                        d365: Math.round(data.weights.d365_weight * 100),
                        lifetime: Math.round(data.weights.lifetime_weight * 100),
                      });
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid="button-weight-settings">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Configure Weights for {countryInfo?.name || selectedCountry}</DialogTitle>
                        <DialogDescription>
                          Adjust how much each time period contributes to the weighted ACOS calculation. Weights must sum to 100%.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="t0-weight">T0 (Since Last Change) %</Label>
                            <Input 
                              id="t0-weight" 
                              type="number" 
                              min="0" 
                              max="100" 
                              value={editWeights.t0}
                              onChange={(e) => handleWeightChange("t0", e.target.value)}
                              data-testid="input-weight-t0"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="d30-weight">30 Days %</Label>
                            <Input 
                              id="d30-weight" 
                              type="number" 
                              min="0" 
                              max="100" 
                              value={editWeights.d30}
                              onChange={(e) => handleWeightChange("d30", e.target.value)}
                              data-testid="input-weight-d30"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="d365-weight">365 Days %</Label>
                            <Input 
                              id="d365-weight" 
                              type="number" 
                              min="0" 
                              max="100" 
                              value={editWeights.d365}
                              onChange={(e) => handleWeightChange("d365", e.target.value)}
                              data-testid="input-weight-d365"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="lifetime-weight">Lifetime %</Label>
                            <Input 
                              id="lifetime-weight" 
                              type="number" 
                              min="0" 
                              max="100" 
                              value={editWeights.lifetime}
                              onChange={(e) => handleWeightChange("lifetime", e.target.value)}
                              data-testid="input-weight-lifetime"
                            />
                          </div>
                        </div>
                        <div className={`text-center p-3 rounded-lg ${weightsValid ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                          Total: {totalWeight}% {weightsValid ? "✓" : "(must equal 100%)"}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setWeightSettingsOpen(false)}>Cancel</Button>
                        <Button 
                          onClick={() => updateWeightsMutation.mutate(editWeights)}
                          disabled={!weightsValid || updateWeightsMutation.isPending}
                          data-testid="button-save-weights"
                        >
                          {updateWeightsMutation.isPending ? "Saving..." : "Save Weights"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 rounded-lg bg-background">
                  <div className="text-2xl font-bold text-primary">{Math.round(data.weights.t0_weight * 100)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">T0 (Since Change)</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-background">
                  <div className="text-2xl font-bold">{Math.round(data.weights.d30_weight * 100)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">30 Days</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-background">
                  <div className="text-2xl font-bold">{Math.round(data.weights.d365_weight * 100)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">365 Days</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-background">
                  <div className="text-2xl font-bold text-muted-foreground">{Math.round(data.weights.lifetime_weight * 100)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">Lifetime</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Target className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{data?.total_recommendations || 0}</div>
                  <div className="text-xs text-muted-foreground">Total Recommendations</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{increaseRecs.length}</div>
                  <div className="text-xs text-muted-foreground">Bid Increases</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <TrendingDown className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{decreaseRecs.length}</div>
                  <div className="text-xs text-muted-foreground">Bid Decreases</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Zap className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {keywordRecs.filter(r => r.confidence === "Extreme" || r.confidence === "High").length}
                  </div>
                  <div className="text-xs text-muted-foreground">High Confidence</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Loading recommendations...
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center text-red-400">
              Error loading recommendations. Please try again.
            </CardContent>
          </Card>
        ) : !data?.recommendations?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-amber-500" />
              <p className="font-medium">No recommendations available</p>
              <p className="text-sm mt-1">All keywords are within the target ACOS range or have insufficient data.</p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="all" className="space-y-4">
            <TabsList>
              <TabsTrigger value="all" data-testid="tab-all">All ({keywordRecs.length})</TabsTrigger>
              <TabsTrigger value="decrease" data-testid="tab-decrease">
                <TrendingDown className="h-4 w-4 mr-1 text-red-400" />
                Decrease ({decreaseRecs.length})
              </TabsTrigger>
              <TabsTrigger value="increase" data-testid="tab-increase">
                <TrendingUp className="h-4 w-4 mr-1 text-green-400" />
                Increase ({increaseRecs.length})
              </TabsTrigger>
            </TabsList>

            {["all", "decrease", "increase"].map(tab => (
              <TabsContent key={tab} value={tab}>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Targeting</TableHead>
                          <TableHead>Campaign / Ad Group</TableHead>
                          <TableHead className="text-right">Current Bid</TableHead>
                          <TableHead className="text-right">Recommended</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          <TableHead className="text-right">
                            <Tooltip>
                              <TooltipTrigger className="cursor-help">Weighted ACOS</TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">
                                  Weighted average: T0 ({data?.weights.t0_weight ? Math.round(data.weights.t0_weight * 100) : 35}%), 
                                  30D ({data?.weights.d30_weight ? Math.round(data.weights.d30_weight * 100) : 25}%), 
                                  365D ({data?.weights.d365_weight ? Math.round(data.weights.d365_weight * 100) : 25}%), 
                                  Lifetime ({data?.weights.lifetime_weight ? Math.round(data.weights.lifetime_weight * 100) : 15}%)
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead className="text-center">Confidence</TableHead>
                          <TableHead className="text-center">
                            <Tooltip>
                              <TooltipTrigger className="cursor-help">
                                <Clock className="h-4 w-4 inline" />
                              </TooltipTrigger>
                              <TooltipContent>Days since last bid change</TooltipContent>
                            </Tooltip>
                          </TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(tab === "all" ? keywordRecs : tab === "decrease" ? decreaseRecs : increaseRecs)
                          .slice(0, 100)
                          .map((rec, i) => (
                            <TableRow key={`${rec.campaign_id}-${rec.targeting}-${i}`} data-testid={`row-recommendation-${i}`}>
                              <TableCell>
                                <div className="font-medium">{rec.targeting}</div>
                                <div className="flex items-center gap-1 mt-1">
                                  {rec.match_type && (
                                    <Badge variant="outline" className="text-xs">{rec.match_type}</Badge>
                                  )}
                                  {rec.hasPlacementRecs && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Link href={`/campaign/${rec.campaign_id}?country=${selectedCountry}&campaignType=products&view=placements`}>
                                          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30 cursor-pointer hover-elevate">
                                            <Layers className="h-3 w-3 mr-1" />
                                            +Placement
                                          </Badge>
                                        </Link>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>This campaign also has placement adjustment recommendations.</p>
                                        <p className="text-muted-foreground text-xs mt-1">Click to view placements</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">{rec.campaign_name}</div>
                                <div className="text-xs text-muted-foreground">{rec.ad_group_name}</div>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(rec.current_bid || 0, selectedCountry)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                {formatCurrency(rec.recommended_bid || 0, selectedCountry)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Badge 
                                  variant="outline" 
                                  className={rec.action === "decrease" 
                                    ? "bg-red-500/10 text-red-400 border-red-500/30" 
                                    : "bg-green-500/10 text-green-400 border-green-500/30"
                                  }
                                >
                                  {rec.action === "decrease" ? <ArrowDown className="h-3 w-3 mr-1" /> : <ArrowUp className="h-3 w-3 mr-1" />}
                                  {Math.abs(rec.change_percent)}%
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge 
                                      variant="outline"
                                      className={getAcosBadgeClass(rec.weighted_acos, rec.acos_target)}
                                    >
                                      {rec.weighted_acos_percent}% / {rec.acos_target_percent}%
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="space-y-1 text-xs">
                                      <div>T0: {formatAcos(rec.t0_acos)} ({rec.t0_clicks} clicks)</div>
                                      <div>30D: {formatAcos(rec.d30_acos)} ({rec.d30_clicks} clicks)</div>
                                      <div>365D: {formatAcos(rec.d365_acos)} ({rec.d365_clicks} clicks)</div>
                                      <div>Lifetime: {formatAcos(rec.lifetime_acos)} ({rec.lifetime_clicks} clicks)</div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={getConfidenceBadgeVariant(rec.confidence)}>
                                  {rec.confidence}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center text-muted-foreground text-sm">
                                {rec.days_since_change === 999 ? "—" : `${rec.days_since_change}d`}
                              </TableCell>
                              <TableCell>
                                <Dialog open={implementDialog?.targeting === rec.targeting && implementDialog?.campaign_id === rec.campaign_id} onOpenChange={(open) => !open && setImplementDialog(null)}>
                                  <DialogTrigger asChild>
                                    <Button 
                                      size="sm" 
                                      variant="ghost"
                                      onClick={() => setImplementDialog(rec)}
                                      data-testid={`button-implement-${i}`}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Mark as Implemented</DialogTitle>
                                      <DialogDescription>
                                        Record that you've implemented this bid change in Amazon Ads Console.
                                      </DialogDescription>
                                    </DialogHeader>
                                    {implementDialog && (
                                      <div className="space-y-4 py-4">
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                          <div>
                                            <div className="text-muted-foreground">Keyword</div>
                                            <div className="font-medium">{implementDialog.targeting}</div>
                                          </div>
                                          <div>
                                            <div className="text-muted-foreground">Match Type</div>
                                            <div className="font-medium">{implementDialog.match_type}</div>
                                          </div>
                                          <div>
                                            <div className="text-muted-foreground">Current Bid</div>
                                            <div className="font-medium">{formatCurrency(implementDialog.current_bid || 0, selectedCountry)}</div>
                                          </div>
                                          <div>
                                            <div className="text-muted-foreground">New Bid</div>
                                            <div className="font-medium text-primary">{formatCurrency(implementDialog.recommended_bid || 0, selectedCountry)}</div>
                                          </div>
                                          <div>
                                            <div className="text-muted-foreground">Current ACOS</div>
                                            <div className="font-medium">{implementDialog.weighted_acos_percent}%</div>
                                          </div>
                                          <div>
                                            <div className="text-muted-foreground">Target ACOS</div>
                                            <div className="font-medium">{implementDialog.acos_target_percent}%</div>
                                          </div>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                          This will record the change for tracking. After 14+ days, we'll analyze if ACOS moved toward target.
                                        </p>
                                      </div>
                                    )}
                                    <DialogFooter>
                                      <Button variant="outline" onClick={() => setImplementDialog(null)}>Cancel</Button>
                                      <Button 
                                        onClick={() => implementDialog && implementMutation.mutate(implementDialog)}
                                        disabled={implementMutation.isPending}
                                        data-testid="button-confirm-implement"
                                      >
                                        {implementMutation.isPending ? "Recording..." : "Mark Implemented"}
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}
