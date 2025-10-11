import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import { useState } from "react";

interface TimeRange {
  label: string;
  days: number;
}

const timeRanges: TimeRange[] = [
  { label: "7D", days: 7 },
  { label: "14D", days: 14 },
  { label: "30D", days: 30 },
  { label: "60D", days: 60 },
  { label: "90D", days: 90 },
];

export default function TimeRangePicker() {
  const [selected, setSelected] = useState(60);

  return (
    <div className="flex items-center gap-2" data-testid="time-range-picker">
      <div className="flex items-center gap-1 border rounded-md p-1">
        {timeRanges.map((range) => (
          <Button
            key={range.days}
            size="sm"
            variant={selected === range.days ? "default" : "ghost"}
            onClick={() => setSelected(range.days)}
            className="h-8"
            data-testid={`time-range-${range.days}d`}
          >
            {range.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="h-8 gap-1" data-testid="time-range-custom">
          <Calendar className="h-3 w-3" />
          Custom
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        Last {selected} days
      </span>
    </div>
  );
}
