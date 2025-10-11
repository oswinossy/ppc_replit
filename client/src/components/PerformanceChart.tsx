import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface ChartDataPoint {
  date: string;
  acos: number;
  sales: number;
}

interface PerformanceChartProps {
  data: ChartDataPoint[];
  currency?: string;
}

export default function PerformanceChart({ data, currency = "€" }: PerformanceChartProps) {
  return (
    <Card className="p-6" data-testid="performance-chart">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">ACOS vs Ad Sales</h3>
          <p className="text-sm text-muted-foreground">Performance trend over time</p>
        </div>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                yAxisId="left"
                stroke="hsl(var(--chart-3))"
                fontSize={12}
                tickFormatter={(value) => `${value}%`}
              />
              <YAxis 
                yAxisId="right" 
                orientation="right"
                stroke="hsl(var(--chart-1))"
                fontSize={12}
                tickFormatter={(value) => `${currency}${value}`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem"
                }}
              />
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="acos" 
                stroke="hsl(var(--chart-3))" 
                strokeWidth={2}
                name="ACOS %"
                dot={false}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="sales" 
                stroke="hsl(var(--chart-1))" 
                strokeWidth={2}
                name={`Sales (${currency})`}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}
