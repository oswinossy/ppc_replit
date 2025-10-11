import RecommendationCard from '../RecommendationCard';

export default function RecommendationCardExample() {
  return (
    <div className="grid grid-cols-2 gap-4 p-6">
      <RecommendationCard 
        searchTerm="wireless headphones"
        currentBid={1.50}
        proposedBid={1.20}
        clicks={342}
        acos={25.3}
        target={20}
        rationale="ACOS above target. Reducing bid by 20% to improve efficiency while maintaining visibility."
        currency="€"
      />
      <RecommendationCard 
        searchTerm="bluetooth speaker"
        currentBid={0.85}
        proposedBid={1.05}
        clicks={156}
        acos={14.8}
        target={20}
        rationale="ACOS well below target. Opportunity to increase bid by 23.5% to capture more volume."
        currency="€"
      />
    </div>
  );
}
