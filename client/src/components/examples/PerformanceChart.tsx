import PerformanceChart from '../PerformanceChart';

const mockData = [
  { date: "Oct 1", acos: 22.5, sales: 1250 },
  { date: "Oct 8", acos: 19.8, sales: 1480 },
  { date: "Oct 15", acos: 18.2, sales: 1620 },
  { date: "Oct 22", acos: 21.3, sales: 1390 },
  { date: "Oct 29", acos: 17.5, sales: 1780 },
  { date: "Nov 5", acos: 16.8, sales: 1920 },
  { date: "Nov 12", acos: 18.9, sales: 1650 },
];

export default function PerformanceChartExample() {
  return (
    <div className="p-6">
      <PerformanceChart data={mockData} currency="€" />
    </div>
  );
}
