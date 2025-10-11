import BreadcrumbNav from '../BreadcrumbNav';

export default function BreadcrumbNavExample() {
  return (
    <div className="p-6">
      <BreadcrumbNav 
        items={[
          { label: "Dashboard", href: "/" },
          { label: "France", href: "/country/FR" },
          { label: "Summer Campaign 2024" }
        ]}
      />
    </div>
  );
}
