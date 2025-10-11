import ConfidenceBadge from '../ConfidenceBadge';

export default function ConfidenceBadgeExample() {
  return (
    <div className="flex gap-2 p-6">
      <ConfidenceBadge clicks={25} />
      <ConfidenceBadge clicks={50} />
      <ConfidenceBadge clicks={150} />
      <ConfidenceBadge clicks={450} />
      <ConfidenceBadge clicks={1200} />
    </div>
  );
}
