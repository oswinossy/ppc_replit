import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import { DateRange } from "react-day-picker";

interface TimeRange {
  label: string;
  days: number | "lifetime";
}

// Lifetime starts from October 1, 2024
const LIFETIME_START = new Date(2024, 9, 1); // Month is 0-indexed, so 9 = October

const timeRanges: TimeRange[] = [
  { label: "14D", days: 14 },
  { label: "30D", days: 30 },
  { label: "60D", days: 60 },
  { label: "365D", days: 365 },
  { label: "Lifetime", days: "lifetime" },
];

interface TimeRangePickerProps {
  value?: { from: string; to: string };
  onChange?: (range: { from: string; to: string }) => void;
}

export default function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
  const [selected, setSelected] = useState<number | "custom" | "lifetime">(60);
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const handlePresetSelect = (days: number | "lifetime") => {
    setSelected(days);
    const to = new Date();
    
    let from: Date;
    if (days === "lifetime") {
      from = LIFETIME_START;
    } else {
      from = subDays(to, days - 1);
    }
    
    if (onChange) {
      onChange({
        from: format(from, 'yyyy-MM-dd'),
        to: format(to, 'yyyy-MM-dd'),
      });
    }
  };

  const handleCustomDateSelect = (range: DateRange | undefined) => {
    setCustomDateRange(range);
    
    if (range?.from && range?.to) {
      setSelected("custom");
      if (onChange) {
        onChange({
          from: format(range.from, 'yyyy-MM-dd'),
          to: format(range.to, 'yyyy-MM-dd'),
        });
      }
      setIsCustomOpen(false);
    }
  };

  // Initialize with 60D on mount
  useEffect(() => {
    if (!value) {
      handlePresetSelect(60);
    }
  }, []);

  const getDisplayText = () => {
    if (selected === "custom" && customDateRange?.from && customDateRange?.to) {
      return `${format(customDateRange.from, 'MMM dd')} - ${format(customDateRange.to, 'MMM dd, yyyy')}`;
    }
    if (selected === "lifetime") {
      return `Since Oct 1, 2024`;
    }
    return `Last ${selected} days`;
  };

  return (
    <div className="flex items-center gap-2" data-testid="time-range-picker">
      <div className="flex items-center gap-1 border rounded-md p-1">
        {timeRanges.map((range) => (
          <Button
            key={String(range.days)}
            size="sm"
            variant={selected === range.days ? "default" : "ghost"}
            onClick={() => handlePresetSelect(range.days)}
            className="h-8"
            data-testid={`time-range-${range.days === "lifetime" ? "lifetime" : range.days + "d"}`}
          >
            {range.label}
          </Button>
        ))}
        <Popover open={isCustomOpen} onOpenChange={setIsCustomOpen}>
          <PopoverTrigger asChild>
            <Button 
              size="sm" 
              variant={selected === "custom" ? "default" : "ghost"} 
              className="h-8 gap-1" 
              data-testid="time-range-custom"
            >
              <CalendarIcon className="h-3 w-3" />
              Custom
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={customDateRange}
              onSelect={handleCustomDateSelect}
              numberOfMonths={2}
              defaultMonth={customDateRange?.from}
            />
          </PopoverContent>
        </Popover>
      </div>
      <span className="text-xs text-muted-foreground">
        {getDisplayText()}
      </span>
    </div>
  );
}
