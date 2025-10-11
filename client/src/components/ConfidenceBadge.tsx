import { Badge } from "@/components/ui/badge";

interface ConfidenceBadgeProps {
  clicks: number;
}

export default function ConfidenceBadge({ clicks }: ConfidenceBadgeProps) {
  const getConfidence = () => {
    if (clicks >= 1000) return { label: "Extreme", color: "bg-green-500/10 text-green-500 border-green-500/20" };
    if (clicks >= 300) return { label: "High", color: "bg-primary/10 text-primary border-primary/20" };
    if (clicks >= 100) return { label: "Good", color: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
    if (clicks >= 30) return { label: "OK", color: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20" };
    return { label: "Low", color: "bg-error/10 text-error border-error/20" };
  };

  const confidence = getConfidence();

  return (
    <Badge variant="outline" className={confidence.color} data-testid={`confidence-${confidence.label.toLowerCase()}`}>
      {confidence.label}
    </Badge>
  );
}
