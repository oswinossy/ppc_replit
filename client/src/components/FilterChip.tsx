import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FilterChipProps {
  label: string;
  value: string;
  onRemove?: () => void;
}

export default function FilterChip({ label, value, onRemove }: FilterChipProps) {
  return (
    <Badge 
      variant="outline" 
      className="bg-primary/10 text-primary border-primary/20 gap-1 pr-1" 
      data-testid={`filter-${label.toLowerCase()}`}
    >
      <span className="text-xs">
        {label}: <span className="font-semibold">{value}</span>
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 rounded-sm hover-elevate active-elevate-2 p-0.5"
          data-testid={`filter-remove-${label.toLowerCase()}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
