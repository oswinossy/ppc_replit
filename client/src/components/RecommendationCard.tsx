import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Info } from "lucide-react";
import ConfidenceBadge from "./ConfidenceBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface RecommendationCardProps {
  targeting: string;
  currentBid: number;
  proposedBid: number;
  clicks: number;
  acos: number;
  target: number;
  rationale: string;
  currency?: string;
}

export default function RecommendationCard({
  targeting,
  currentBid,
  proposedBid,
  clicks,
  acos,
  target,
  rationale,
  currency = "€"
}: RecommendationCardProps) {
  const delta = ((proposedBid - currentBid) / currentBid) * 100;
  const deltaColor = delta > 0 ? "text-green-500" : delta < 0 ? "text-error" : "text-muted-foreground";

  return (
    <Card className="p-4" data-testid={`recommendation-${targeting}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium truncate">{targeting}</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {clicks} clicks · ACOS {acos.toFixed(1)}% (target: {target}%)
            </p>
          </div>
          <ConfidenceBadge clicks={clicks} />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-lg font-bold font-mono">{currency}{currentBid.toFixed(2)}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">Proposed</p>
            <p className="text-lg font-bold font-mono">{currency}{proposedBid.toFixed(2)}</p>
          </div>
          <div className={`text-sm font-medium ${deltaColor} flex-shrink-0`}>
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
          </div>
        </div>

        <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-md">
          <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground flex-1">{rationale}</p>
        </div>

        <Button size="sm" className="w-full" data-testid={`apply-recommendation-${targeting}`}>
          Apply Recommendation
        </Button>
      </div>
    </Card>
  );
}
