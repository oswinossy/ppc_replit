import { getConfidenceLevel } from './calculations';

interface SearchTermData {
  searchTerm: string;
  clicks: number;
  impressions: number;
  cost: number;
  sales: number;
  orders: number;
  currentBid: number | null;
  cpc: number;
  matchType?: string;
}

interface BidRecommendation {
  searchTerm: string;
  currentBid: number;
  proposedBid: number;
  delta: number;
  deltaPercent: number;
  clicks: number;
  impressions: number;
  cost: number;
  sales: number;
  orders: number;
  acos: number;
  cvr: number;
  cpc: number;
  targetAcos: number;
  rationale: string;
  confidence: string;
  confidenceLevel: number;
  action: 'increase' | 'decrease' | 'maintain' | 'review';
  matchType?: string;
}

const TARGET_ACOS = 20;
const ACOS_LOWER_BOUND = TARGET_ACOS * 0.8; // 16% - below this, increase bid
const ACOS_UPPER_BOUND = TARGET_ACOS * 1.1; // 22% - above this, decrease bid
const MIN_CLICKS_FOR_RECOMMENDATION = 30;
const MAX_CHANGE_PERCENT = 25; // Cap at ±25% per adjustment (incremental approach)
const HIGH_IMPRESSIONS_THRESHOLD = 1000;
const LOW_SPEND_THRESHOLD = 0.10; // €0.10

export function generateBidRecommendation(
  term: SearchTermData,
  targetAcos: number = TARGET_ACOS,
  campaignMedianCPC: number = 1.0
): BidRecommendation | null {
  const { searchTerm, clicks, impressions, cost, sales, orders, currentBid, cpc, matchType } = term;
  
  const lowerBound = targetAcos * 0.8;
  const upperBound = targetAcos * 1.1;
  
  const currentAcos = sales > 0 ? (cost / sales) * 100 : 0;
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
  const baseBid = currentBid || cpc || campaignMedianCPC;
  const confidence = getConfidenceLevel(clicks);

  if (clicks < MIN_CLICKS_FOR_RECOMMENDATION) {
    return null;
  }

  if (impressions >= HIGH_IMPRESSIONS_THRESHOLD && cost < LOW_SPEND_THRESHOLD) {
    return null;
  }

  let proposedBid = baseBid;
  let rationale = '';
  let action: 'increase' | 'decrease' | 'maintain' | 'review' = 'maintain';

  if (sales === 0 && clicks >= MIN_CLICKS_FOR_RECOMMENDATION) {
    const decreasePercent = Math.min(MAX_CHANGE_PERCENT, 15 + Math.floor(clicks / 50) * 5);
    proposedBid = baseBid * (1 - decreasePercent / 100);
    action = 'decrease';
    rationale = `No sales after ${clicks} clicks (CVR: 0%). ` +
      `Reducing bid by ${decreasePercent}% to limit exposure. ` +
      `Formula: base bid reduced by ${decreasePercent}% based on click volume. ` +
      `Consider negative targeting if pattern continues.`;
  }
  else if (sales > 0 && currentAcos < lowerBound) {
    const formulaBid = baseBid * (targetAcos / currentAcos);
    const maxIncrease = baseBid * (1 + MAX_CHANGE_PERCENT / 100);
    proposedBid = Math.min(formulaBid, maxIncrease);
    action = 'increase';
    
    const increasePercent = ((proposedBid - baseBid) / baseBid * 100).toFixed(1);
    rationale = `ACOS ${currentAcos.toFixed(1)}% is below target range (${lowerBound.toFixed(0)}%-${upperBound.toFixed(0)}%). ` +
      `CVR: ${cvr.toFixed(2)}%. ` +
      `Increasing bid by ${increasePercent}% to capture more volume. ` +
      `Formula: ${baseBid.toFixed(2)} × (${targetAcos}/${currentAcos.toFixed(1)}) = ${formulaBid.toFixed(2)}, capped at +${MAX_CHANGE_PERCENT}%.`;
  }
  else if (sales > 0 && currentAcos > upperBound) {
    const formulaBid = baseBid * (targetAcos / currentAcos);
    const maxDecrease = baseBid * (1 - MAX_CHANGE_PERCENT / 100);
    proposedBid = Math.max(formulaBid, maxDecrease);
    action = 'decrease';
    
    const decreasePercent = ((baseBid - proposedBid) / baseBid * 100).toFixed(1);
    rationale = `ACOS ${currentAcos.toFixed(1)}% exceeds target range (${lowerBound.toFixed(0)}%-${upperBound.toFixed(0)}%). ` +
      `CVR: ${cvr.toFixed(2)}%. ` +
      `Decreasing bid by ${decreasePercent}% to improve efficiency. ` +
      `Formula: ${baseBid.toFixed(2)} × (${targetAcos}/${currentAcos.toFixed(1)}) = ${formulaBid.toFixed(2)}, capped at -${MAX_CHANGE_PERCENT}%.`;
  }
  else if (sales > 0 && currentAcos >= lowerBound && currentAcos <= upperBound) {
    return null;
  }
  else {
    return null;
  }

  const minBid = 0.02;
  const maxBid = baseBid * 2;
  proposedBid = Math.max(minBid, Math.min(maxBid, proposedBid));
  proposedBid = Math.round(proposedBid * 100) / 100;

  const delta = proposedBid - baseBid;
  const deltaPercent = baseBid > 0 ? (delta / baseBid) * 100 : 0;

  return {
    searchTerm,
    currentBid: Math.round(baseBid * 100) / 100,
    proposedBid,
    delta: Math.round(delta * 100) / 100,
    deltaPercent: Math.round(deltaPercent * 10) / 10,
    clicks,
    impressions,
    cost: Math.round(cost * 100) / 100,
    sales: Math.round(sales * 100) / 100,
    orders,
    acos: Math.round(currentAcos * 10) / 10,
    cvr: Math.round(cvr * 100) / 100,
    cpc: Math.round(cpc * 100) / 100,
    targetAcos,
    rationale,
    confidence: confidence.label,
    confidenceLevel: confidence.level,
    action,
    matchType,
  };
}

export function generateBulkRecommendations(
  terms: SearchTermData[],
  targetAcos: number = TARGET_ACOS
): BidRecommendation[] {
  const cpcs = terms.filter(t => t.cpc > 0).map(t => t.cpc);
  const medianCPC = cpcs.length > 0 
    ? cpcs.sort((a, b) => a - b)[Math.floor(cpcs.length / 2)] 
    : 1.0;

  const recommendations: BidRecommendation[] = [];
  
  for (const term of terms) {
    const rec = generateBidRecommendation(term, targetAcos, medianCPC);
    if (rec) {
      recommendations.push(rec);
    }
  }

  return recommendations.sort((a, b) => {
    if (a.action === 'decrease' && b.action !== 'decrease') return -1;
    if (b.action === 'decrease' && a.action !== 'decrease') return 1;
    return Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent);
  });
}

interface NegativeKeywordCandidate {
  searchTerm: string;
  type: 'Exact' | 'Phrase';
  clicks: number;
  impressions: number;
  cost: number;
  cpc: number;
  rationale: string;
  priority: 'High' | 'Medium' | 'Low';
}

export function detectNegativeKeywords(
  terms: SearchTermData[],
  minClicks: number = 20
): NegativeKeywordCandidate[] {
  const candidates: NegativeKeywordCandidate[] = [];
  
  const wastefulTerms = terms.filter(t => t.clicks >= minClicks && t.sales === 0);
  
  const tokenGroups: Record<string, typeof wastefulTerms> = {};
  
  wastefulTerms.forEach(term => {
    const tokens = term.searchTerm.toLowerCase().split(/\s+/).sort().join(' ');
    if (!tokenGroups[tokens]) {
      tokenGroups[tokens] = [];
    }
    tokenGroups[tokens].push(term);
  });

  wastefulTerms.forEach(term => {
    const cluster = tokenGroups[term.searchTerm.toLowerCase().split(/\s+/).sort().join(' ')];
    
    let priority: 'High' | 'Medium' | 'Low' = 'Low';
    if (term.clicks >= 100 || term.cost >= 50) priority = 'High';
    else if (term.clicks >= 50 || term.cost >= 20) priority = 'Medium';
    
    if (cluster.length > 1) {
      const totalClicks = cluster.reduce((sum, t) => sum + t.clicks, 0);
      const totalCost = cluster.reduce((sum, t) => sum + t.cost, 0);
      
      if (!candidates.find(c => c.searchTerm === term.searchTerm)) {
        candidates.push({
          searchTerm: term.searchTerm,
          type: 'Phrase',
          clicks: term.clicks,
          impressions: term.impressions,
          cost: term.cost,
          cpc: term.cpc,
          rationale: `Part of cluster with ${cluster.length} related terms. Total: ${totalClicks} clicks, €${totalCost.toFixed(2)} wasted.`,
          priority
        });
      }
    } else {
      candidates.push({
        searchTerm: term.searchTerm,
        type: 'Exact',
        clicks: term.clicks,
        impressions: term.impressions,
        cost: term.cost,
        cpc: term.cpc,
        rationale: `${term.clicks} clicks with no sales, costing €${term.cost.toFixed(2)}.`,
        priority
      });
    }
  });

  return candidates.sort((a, b) => {
    const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.cost - a.cost;
  });
}

export function formatRecommendationsForCSV(recommendations: BidRecommendation[]): string {
  const headers = [
    'Search Term',
    'Match Type',
    'Current Bid',
    'Proposed Bid',
    'Change (%)',
    'Action',
    'Clicks',
    'Impressions',
    'Cost',
    'Sales',
    'Orders',
    'ACOS (%)',
    'CVR (%)',
    'CPC',
    'Target ACOS (%)',
    'Confidence',
    'Rationale'
  ];
  
  const rows = recommendations.map(rec => [
    `"${rec.searchTerm.replace(/"/g, '""')}"`,
    rec.matchType || '',
    rec.currentBid.toFixed(2),
    rec.proposedBid.toFixed(2),
    rec.deltaPercent.toFixed(1),
    rec.action,
    rec.clicks,
    rec.impressions,
    rec.cost.toFixed(2),
    rec.sales.toFixed(2),
    rec.orders,
    rec.acos.toFixed(1),
    rec.cvr.toFixed(2),
    rec.cpc.toFixed(2),
    rec.targetAcos,
    rec.confidence,
    `"${rec.rationale.replace(/"/g, '""')}"`
  ].join(','));
  
  return [headers.join(','), ...rows].join('\n');
}

export function formatNegativeKeywordsForCSV(candidates: NegativeKeywordCandidate[]): string {
  const headers = [
    'Search Term',
    'Negative Type',
    'Priority',
    'Clicks',
    'Impressions',
    'Cost',
    'CPC',
    'Rationale'
  ];
  
  const rows = candidates.map(c => [
    `"${c.searchTerm.replace(/"/g, '""')}"`,
    c.type,
    c.priority,
    c.clicks,
    c.impressions,
    c.cost.toFixed(2),
    c.cpc.toFixed(2),
    `"${c.rationale.replace(/"/g, '""')}"`
  ].join(','));
  
  return [headers.join(','), ...rows].join('\n');
}
