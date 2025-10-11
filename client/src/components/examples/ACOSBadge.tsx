import ACOSBadge from '../ACOSBadge';

export default function ACOSBadgeExample() {
  return (
    <div className="flex gap-2 p-6">
      <ACOSBadge value={14.2} />
      <ACOSBadge value={19.5} />
      <ACOSBadge value={25.8} />
      <ACOSBadge value={42.3} />
    </div>
  );
}
