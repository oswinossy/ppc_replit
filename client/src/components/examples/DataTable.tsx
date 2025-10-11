import DataTable from '../DataTable';
import ACOSBadge from '../ACOSBadge';

const mockData = [
  { campaign: "Summer Sale 2024", clicks: 1234, cost: 1876.45, sales: 9342.21, acos: 20.1 },
  { campaign: "Brand Awareness", clicks: 856, cost: 1432.12, sales: 7854.33, acos: 18.2 },
  { campaign: "Holiday Promo", clicks: 2341, cost: 3124.89, sales: 14232.45, acos: 22.0 },
];

export default function DataTableExample() {
  return (
    <div className="p-6">
      <DataTable 
        columns={[
          { key: "campaign", label: "Campaign", sortable: true },
          { key: "clicks", label: "Clicks", align: "right", sortable: true },
          { key: "cost", label: "Cost (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
          { key: "sales", label: "Sales (€)", align: "right", sortable: true, render: (val) => val.toFixed(2) },
          { key: "acos", label: "ACOS", align: "right", sortable: true, render: (val) => <ACOSBadge value={val} /> },
        ]}
        data={mockData}
        onRowClick={(row) => console.log('Clicked row:', row)}
      />
    </div>
  );
}
