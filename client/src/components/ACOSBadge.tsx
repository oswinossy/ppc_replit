import { Badge } from "@/components/ui/badge";

interface ACOSBadgeProps {
  value: number;
  target?: number;
}

export default function ACOSBadge({ value, target = 20 }: ACOSBadgeProps) {
  const getVariant = () => {
    if (value <= target * 0.8) return "default";
    if (value <= target) return "outline";
    if (value <= target * 1.5) return "secondary";
    return "destructive";
  };

  const getBgColor = () => {
    if (value <= target * 0.8) return "bg-green-500/10 text-green-500 border-green-500/20";
    if (value <= target) return "bg-primary/10 text-primary border-primary/20";
    if (value <= target * 1.5) return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    return "bg-error/10 text-error border-error/20";
  };

  return (
    <Badge variant={getVariant()} className={getBgColor()} data-testid={`acos-badge-${value}`}>
      {value.toFixed(1)}%
    </Badge>
  );
}
