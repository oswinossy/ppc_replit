import KPICard from '../KPICard';

export default function KPICardExample() {
  return (
    <div className="grid grid-cols-3 gap-4 p-6">
      <KPICard 
        label="Ad Sales" 
        value="47,832" 
        currency="€"
        trend={{ value: 12.5, direction: "up" }}
      />
      <KPICard 
        label="ACOS" 
        value="18.2%" 
        trend={{ value: 3.2, direction: "down" }}
      />
      <KPICard 
        label="CPC" 
        value="0.87" 
        currency="€"
        trend={{ value: 0, direction: "flat" }}
      />
    </div>
  );
}
