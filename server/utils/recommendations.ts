import { getConfidenceLevel } from './calculations';

interface SearchTermData {
  searchTerm: string;
  clicks: number;
  cost: number;
  sales: number;
  currentBid: number | null;
  cpc: number;
}

interface BidRecommendation {
  searchTerm: string;
  currentBid: number;
  proposedBid: number;
  delta: number;
  clicks: number;
  cost: number;
  sales: number;
  acos: number;
  targetAcos: number;
  rationale: string;
  confidence: string;
}

export function generateBidRecommendation(
  term: SearchTermData,
  targetAcos: number = 20,
  adGroupMedianCPC: number = 1.0
): BidRecommendation | null {
  const { searchTerm, clicks, cost, sales, currentBid, cpc } = term;
  
  // Eligibility check
  if (clicks < 30) {
    return null;
  }

  const currentAcos = sales > 0 ? (cost / sales) * 100 : 0;
  const baseBid = currentBid || cpc || adGroupMedianCPC;
  const confidence = getConfidenceLevel(clicks);

  let proposedBid = baseBid;
  let rationale = '';

  // Case 1: No sales, decrease bid
  if (sales === 0 && clicks >= 30) {
    const spendVsMedian = cost / (adGroupMedianCPC * clicks);
    if (spendVsMedian > 1.5) {
      proposedBid = baseBid * 0.70; // -30%
      rationale = `No sales with ${clicks} clicks and high CPC. Reducing bid by 30% to minimize waste.`;
    } else if (spendVsMedian > 1.2) {
      proposedBid = baseBid * 0.80; // -20%
      rationale = `No sales with ${clicks} clicks. Reducing bid by 20% to limit exposure.`;
    } else {
      proposedBid = baseBid * 0.85; // -15%
      rationale = `No sales with ${clicks} clicks. Reducing bid by 15% to test lower cost point.`;
    }
  }
  // Case 2: ACOS well below target, increase bid
  else if (currentAcos <= targetAcos * 0.8 && clicks >= 30 && sales > 0) {
    const acosRatio = currentAcos / targetAcos;
    if (clicks >= 300) {
      proposedBid = baseBid * 1.20; // +20%
      rationale = `ACOS at ${currentAcos.toFixed(1)}% (target: ${targetAcos}%) with strong data (${clicks} clicks). Increasing bid by 20% to capture more volume.`;
    } else if (clicks >= 100) {
      proposedBid = baseBid * 1.15; // +15%
      rationale = `ACOS at ${currentAcos.toFixed(1)}% (target: ${targetAcos}%) with good data. Increasing bid by 15% for growth.`;
    } else {
      proposedBid = baseBid * 1.10; // +10%
      rationale = `ACOS at ${currentAcos.toFixed(1)}% (target: ${targetAcos}%). Increasing bid by 10% to expand reach.`;
    }
  }
  // Case 3: Standard ACOS-based adjustment
  else if (sales > 0) {
    const targetBid = baseBid * (targetAcos / currentAcos);
    proposedBid = targetBid;
    
    if (currentAcos > targetAcos) {
      rationale = `ACOS at ${currentAcos.toFixed(1)}% exceeds target of ${targetAcos}%. Adjusting bid to optimize efficiency.`;
    } else {
      rationale = `ACOS at ${currentAcos.toFixed(1)}% is near target (${targetAcos}%). Fine-tuning bid based on performance.`;
    }
  } else {
    return null;
  }

  // Apply safeguards: clamp between 20% and 150% of base bid
  const minBid = baseBid * 0.20;
  const maxBid = baseBid * 1.50;
  proposedBid = Math.max(minBid, Math.min(maxBid, proposedBid));

  // Round to 2 decimal places
  proposedBid = Math.round(proposedBid * 100) / 100;

  const delta = ((proposedBid - baseBid) / baseBid) * 100;

  return {
    searchTerm,
    currentBid: baseBid,
    proposedBid,
    delta,
    clicks,
    cost,
    sales,
    acos: currentAcos,
    targetAcos,
    rationale,
    confidence: confidence.label,
  };
}

export function detectNegativeKeywords(
  terms: SearchTermData[]
): Array<{ searchTerm: string; type: 'Exact' | 'Phrase'; clicks: number; cost: number; rationale: string }> {
  const negatives: Array<{ searchTerm: string; type: 'Exact' | 'Phrase'; clicks: number; cost: number; rationale: string }> = [];
  
  // Find terms with clicks >= 20 and sales = 0
  const wastefulTerms = terms.filter(t => t.clicks >= 20 && t.sales === 0);
  
  // Group by token similarity for phrase match detection
  const tokenGroups: Record<string, typeof wastefulTerms> = {};
  
  wastefulTerms.forEach(term => {
    const tokens = term.searchTerm.toLowerCase().split(/\s+/).sort().join(' ');
    if (!tokenGroups[tokens]) {
      tokenGroups[tokens] = [];
    }
    tokenGroups[tokens].push(term);
  });

  // Suggest exact match for individual terms
  wastefulTerms.forEach(term => {
    const cluster = tokenGroups[term.searchTerm.toLowerCase().split(/\s+/).sort().join(' ')];
    
    if (cluster.length > 1) {
      // Part of a cluster - suggest phrase match
      if (!negatives.find(n => n.searchTerm === term.searchTerm)) {
        negatives.push({
          searchTerm: term.searchTerm,
          type: 'Phrase',
          clicks: term.clicks,
          cost: term.cost,
          rationale: `Cluster of ${cluster.length} related terms with no sales. Total ${cluster.reduce((sum, t) => sum + t.clicks, 0)} clicks wasted.`
        });
      }
    } else {
      // Single term - suggest exact match
      negatives.push({
        searchTerm: term.searchTerm,
        type: 'Exact',
        clicks: term.clicks,
        cost: term.cost,
        rationale: `${term.clicks} clicks with no sales, costing ${term.cost.toFixed(2)}.`
      });
    }
  });

  return negatives;
}
