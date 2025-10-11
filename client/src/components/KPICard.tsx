import { Card } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string;
  trend?: {
    value: number;
    direction: "up" | "down" | "flat";
  };
  currency?: string;
}

export default function KPICard({ label, value, trend, currency }: KPICardProps) {
  const getTrendColor = () => {
    if (!trend) return "";
    if (trend.direction === "up") return "text-green-500";
    if (trend.direction === "down") return "text-error";
    return "text-muted-foreground";
  };

  const TrendIcon = trend?.direction === "up" ? ArrowUp : trend?.direction === "down" ? ArrowDown : Minus;

  return (
    <Card className="p-4 hover-elevate" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold font-mono">
            {currency && <span className="text-xl">{currency}</span>}
            {value}
          </p>
          {trend && (
            <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor()}`}>
              <TrendIcon className="h-3 w-3" />
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
