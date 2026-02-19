import postgres from 'postgres';
import { getWeightsForCountry, saveRecommendation } from '../migrations/biddingStrategy';

const COUNTRIES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL', 'SE', 'UK', 'US'];

export async function generateDailyRecommendations(): Promise<{ total: number; countries: number; keywords: number; placements: number }> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  let totalKeywords = 0;
  let totalPlacements = 0;
  let countriesProcessed = 0;

  for (const country of COUNTRIES) {
    try {
      const keywordCount = await generateKeywordRecommendationsForCountry(country, connectionUrl);
      const productPlacementCount = await generateProductPlacementRecommendationsForCountry(country, connectionUrl);
      const brandPlacementCount = await generateBrandPlacementRecommendationsForCountry(country, connectionUrl);
      const placementCount = productPlacementCount + brandPlacementCount;

      if (keywordCount > 0 || placementCount > 0) {
        totalKeywords += keywordCount;
        totalPlacements += placementCount;
        countriesProcessed++;
        console.log(`[RecommendationGenerator] ${country}: ${keywordCount} keyword + ${productPlacementCount} product placement + ${brandPlacementCount} brand placement recommendations`);
      }
    } catch (error) {
      console.error(`[RecommendationGenerator] Error processing ${country}:`, error);
    }
  }

  return { total: totalKeywords + totalPlacements, countries: countriesProcessed, keywords: totalKeywords, placements: totalPlacements };
}

// Generate recommendations for a single country (faster for on-demand requests)
export async function generateRecommendationsForCountry(country: string): Promise<{ keywords: number; placements: number; total: number }> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');

  const keywordCount = await generateKeywordRecommendationsForCountry(country, connectionUrl);
  const productPlacementCount = await generateProductPlacementRecommendationsForCountry(country, connectionUrl);
  const brandPlacementCount = await generateBrandPlacementRecommendationsForCountry(country, connectionUrl);
  const placementCount = productPlacementCount + brandPlacementCount;

  console.log(`[RecommendationGenerator] ${country}: ${keywordCount} keyword + ${productPlacementCount} product placement + ${brandPlacementCount} brand placement recommendations`);

  return { keywords: keywordCount, placements: placementCount, total: keywordCount + placementCount };
}

async function generateKeywordRecommendationsForCountry(country: string, connectionUrl: string): Promise<number> {
  const sqlClient = postgres(connectionUrl);

  try {
    const weights = await getWeightsForCountry(country);

    const acosTargetsResult = await sqlClient`
      SELECT campaign_id, acos_target, campaign_name
      FROM "ACOS_Target_Campaign"
      WHERE country = ${country}
    `;
    const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

    if (acosTargetsMap.size === 0) {
      return 0;
    }

    const today = new Date();
    const d30Ago = new Date(today);
    d30Ago.setDate(d30Ago.getDate() - 30);
    const d365Ago = new Date(today);
    d365Ago.setDate(d365Ago.getDate() - 365);
    const d30AgoStr = d30Ago.toISOString().split('T')[0];
    const d365AgoStr = d365Ago.toISOString().split('T')[0];

    const keywordData = await sqlClient`
      WITH campaign_t0 AS (
        SELECT campaign_id, last_change_date
        FROM s_campaign_t0
        WHERE country = ${country}
      ),
      keyword_base AS (
        SELECT
          s."campaignId" as campaign_id,
          s."campaignName" as campaign_name,
          s."adGroupId" as ad_group_id,
          s."adGroupName" as ad_group_name,
          s.keyword as targeting,
          s."matchType" as match_type,
          CAST(s."keywordBid" AS NUMERIC) as keyword_bid,
          s.date::text as date,
          COALESCE(s.clicks, 0) as clicks,
          COALESCE(s.cost, 0) as cost,
          COALESCE(CAST(s."sales30d" AS NUMERIC), 0) as sales,
          COALESCE(CAST(s."purchases30d" AS NUMERIC), 0) as orders,
          ct.last_change_date::text as last_change_date
        FROM "s_products_search_terms" s
        LEFT JOIN campaign_t0 ct
          ON s."campaignId"::text = ct.campaign_id
        WHERE s.country = ${country}
      )
      SELECT
        campaign_id,
        campaign_name,
        ad_group_id,
        ad_group_name,
        targeting,
        match_type,
        MAX(keyword_bid) as current_bid,
        MAX(last_change_date) as last_change_date,
        SUM(clicks) as lifetime_clicks,
        SUM(cost) as lifetime_cost,
        SUM(sales) as lifetime_sales,
        SUM(orders) as lifetime_orders,
        SUM(CASE WHEN date >= ${d365AgoStr} THEN clicks ELSE 0 END) as d365_clicks,
        SUM(CASE WHEN date >= ${d365AgoStr} THEN cost ELSE 0 END) as d365_cost,
        SUM(CASE WHEN date >= ${d365AgoStr} THEN sales ELSE 0 END) as d365_sales,
        SUM(CASE WHEN date >= ${d365AgoStr} THEN orders ELSE 0 END) as d365_orders,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN clicks ELSE 0 END) as d30_clicks,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN cost ELSE 0 END) as d30_cost,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN sales ELSE 0 END) as d30_sales,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN orders ELSE 0 END) as d30_orders,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN clicks ELSE 0 END) as t0_clicks,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN cost ELSE 0 END) as t0_cost,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN sales ELSE 0 END) as t0_sales,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN orders ELSE 0 END) as t0_orders
      FROM keyword_base
      GROUP BY campaign_id, campaign_name, ad_group_id, ad_group_name, targeting, match_type
      HAVING SUM(clicks) >= 30
      ORDER BY SUM(cost) DESC
      LIMIT 500
    `;

    let savedCount = 0;
    const batchId = `daily_${new Date().toISOString().split('T')[0]}`;

    for (const kw of keywordData) {
      const campaignTarget = acosTargetsMap.get(kw.campaign_id);
      if (!campaignTarget) continue;

      const targetAcos = campaignTarget.target;
      const acosWindow = 0.03;

      const t0Clicks = Number(kw.t0_clicks);
      const t0Cost = Number(kw.t0_cost);
      const t0Sales = Number(kw.t0_sales);
      const lastChangeDate = kw.last_change_date;

      const t0Acos = t0Sales > 0 ? t0Cost / t0Sales : (t0Clicks >= 30 ? 999 : null);
      const d30Acos = Number(kw.d30_sales) > 0 ? Number(kw.d30_cost) / Number(kw.d30_sales) : (Number(kw.d30_clicks) >= 30 ? 999 : null);
      const d365Acos = Number(kw.d365_sales) > 0 ? Number(kw.d365_cost) / Number(kw.d365_sales) : (Number(kw.d365_clicks) >= 30 ? 999 : null);
      const lifetimeAcos = Number(kw.lifetime_sales) > 0 ? Number(kw.lifetime_cost) / Number(kw.lifetime_sales) : (Number(kw.lifetime_clicks) >= 30 ? 999 : null);

      const daysSinceChange = lastChangeDate
        ? Math.floor((today.getTime() - new Date(lastChangeDate).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      if (daysSinceChange < 14) continue;

      let weightedAcos = 0;
      let totalWeight = 0;

      if (t0Acos !== null && t0Acos !== 999) {
        weightedAcos += t0Acos * weights.t0_weight;
        totalWeight += weights.t0_weight;
      }
      if (d30Acos !== null && d30Acos !== 999) {
        weightedAcos += d30Acos * weights.d30_weight;
        totalWeight += weights.d30_weight;
      }
      if (d365Acos !== null && d365Acos !== 999) {
        weightedAcos += d365Acos * weights.d365_weight;
        totalWeight += weights.d365_weight;
      }
      if (lifetimeAcos !== null && lifetimeAcos !== 999) {
        weightedAcos += lifetimeAcos * weights.lifetime_weight;
        totalWeight += weights.lifetime_weight;
      }

      if (totalWeight === 0) continue;
      weightedAcos = weightedAcos / totalWeight;

      const lowerBound = targetAcos - acosWindow;
      const upperBound = targetAcos + acosWindow;

      if (weightedAcos >= lowerBound && weightedAcos <= upperBound) continue;

      const currentBid = Number(kw.current_bid) || 0;
      if (currentBid <= 0) continue;

      let bidMultiplier = targetAcos / weightedAcos;
      bidMultiplier = Math.max(0.5, Math.min(1.5, bidMultiplier));
      const recommendedBid = Math.round(currentBid * bidMultiplier * 100) / 100;

      const totalClicks = Number(kw.lifetime_clicks);
      let confidence = 'Low';
      if (totalClicks >= 200) confidence = 'Extreme';
      else if (totalClicks >= 100) confidence = 'High';
      else if (totalClicks >= 50) confidence = 'Good';
      else if (totalClicks >= 30) confidence = 'OK';

      const action = weightedAcos > targetAcos ? 'decrease' : 'increase';

      await saveRecommendation({
        country,
        campaign_id: kw.campaign_id,
        campaign_name: kw.campaign_name,
        ad_group_id: kw.ad_group_id,
        ad_group_name: kw.ad_group_name,
        targeting: kw.targeting,
        match_type: kw.match_type,
        recommendation_type: 'keyword_bid',
        old_value: currentBid,
        recommended_value: recommendedBid,
        pre_acos_t0: t0Acos !== null && t0Acos !== 999 ? t0Acos : undefined,
        pre_acos_30d: d30Acos !== null && d30Acos !== 999 ? d30Acos : undefined,
        pre_acos_365d: d365Acos !== null && d365Acos !== 999 ? d365Acos : undefined,
        pre_acos_lifetime: lifetimeAcos !== null && lifetimeAcos !== 999 ? lifetimeAcos : undefined,
        pre_clicks_t0: Math.round(t0Clicks),
        pre_clicks_30d: Math.round(Number(kw.d30_clicks) || 0),
        pre_clicks_365d: Math.round(Number(kw.d365_clicks) || 0),
        pre_clicks_lifetime: Math.round(totalClicks),
        pre_cost_t0: t0Cost,
        pre_cost_30d: Number(kw.d30_cost),
        pre_cost_365d: Number(kw.d365_cost),
        pre_cost_lifetime: Number(kw.lifetime_cost),
        pre_orders_t0: Math.round(Number(kw.t0_orders) || 0),
        pre_orders_30d: Math.round(Number(kw.d30_orders) || 0),
        pre_orders_365d: Math.round(Number(kw.d365_orders) || 0),
        pre_orders_lifetime: Math.round(Number(kw.lifetime_orders) || 0),
        weighted_acos: weightedAcos,
        acos_target: targetAcos,
        confidence,
        reason: `Weighted ACOS (${Math.round(weightedAcos * 100)}%) is ${action === 'decrease' ? 'above' : 'below'} target (${Math.round(targetAcos * 100)}%)`
      });

      savedCount++;
    }

    return savedCount;
  } finally {
    await sqlClient.end();
  }
}

// Shared interface for placement performance data
interface PlacementPerformanceRow {
  campaign_id: string;
  campaign_name: string;
  placement: string;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  currentAdjustment: number;
  lastChangeDate?: string;
}

// Shared placement recommendation processing logic used by both product and brand placements
async function processPlacementRecommendations(
  placementData: PlacementPerformanceRow[],
  acosTargetsMap: Map<string, { target: number; name: string }>,
  country: string,
  recommendationType: string,
  minClicks: number,
  acosWindow: number
): Promise<number> {
  interface PlacementRec {
    campaign_id: string;
    campaign_name: string;
    placement: string;
    currentAdjustment: number;
    targetAdjustment: number;
    acos: number;
    targetAcos: number;
    clicks: number;
    confidence: string;
    action: string;
  }
  const campaignRecommendations = new Map<string, PlacementRec[]>();
  const today = new Date();

  for (const p of placementData) {
    // 14-day cooling period: skip campaigns changed less than 14 days ago
    const daysSinceChange = p.lastChangeDate
      ? Math.floor((today.getTime() - new Date(p.lastChangeDate).getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    if (daysSinceChange < 14) continue;

    const campaignTarget = acosTargetsMap.get(p.campaign_id);
    if (!campaignTarget) continue;

    const targetAcos = campaignTarget.target * 100; // Convert to percentage
    const clicks = p.clicks;
    const cost = p.cost;
    const sales = p.sales;
    const currentAdjustment = p.currentAdjustment;

    if (clicks < minClicks) continue;

    // Calculate ACOS (999 = high clicks but no sales = problem)
    const acos = sales > 0 ? (cost / sales) * 100 : (clicks >= minClicks ? 999 : null);
    if (acos === null) continue;

    // Skip if ACOS is within target window
    if (acos !== 999 && acos >= targetAcos - acosWindow && acos <= targetAcos + acosWindow) {
      continue;
    }

    // Calculate target bid adjustment based on ACOS performance (never below 0%)
    let targetAdjustment: number | null = null;

    if (acos !== 999 && acos > 0) {
      const multiplier = targetAcos / acos;
      const adjustmentChange = Math.round((multiplier - 1) * 50);
      targetAdjustment = Math.max(0, Math.min(900, currentAdjustment + adjustmentChange));
      targetAdjustment = Math.round(targetAdjustment / 5) * 5;
    } else if (acos === 999) {
      targetAdjustment = Math.max(0, currentAdjustment - 25);
      targetAdjustment = Math.round(targetAdjustment / 5) * 5;
    }

    if (targetAdjustment === null || targetAdjustment === currentAdjustment) continue;

    let confidence = 'Low';
    if (clicks >= 200) confidence = 'Extreme';
    else if (clicks >= 100) confidence = 'High';
    else if (clicks >= 50) confidence = 'Good';
    else if (clicks >= minClicks) confidence = 'OK';

    const action = acos > targetAcos ? 'decrease' : 'increase';

    const rec: PlacementRec = {
      campaign_id: p.campaign_id,
      campaign_name: p.campaign_name,
      placement: p.placement,
      currentAdjustment,
      targetAdjustment,
      acos,
      targetAcos,
      clicks,
      confidence,
      action
    };

    if (!campaignRecommendations.has(p.campaign_id)) {
      campaignRecommendations.set(p.campaign_id, []);
    }
    campaignRecommendations.get(p.campaign_id)!.push(rec);
  }

  // Process each campaign's recommendations and enforce "at least one 0%" rule
  let savedCount = 0;
  for (const [campaignId, recs] of Array.from(campaignRecommendations.entries())) {
    const allAboveZero = recs.every((r: PlacementRec) => r.targetAdjustment > 0);

    if (allAboveZero && recs.length >= 3) {
      let lowestIdx = 0;
      for (let i = 1; i < recs.length; i++) {
        if (recs[i].targetAdjustment < recs[lowestIdx].targetAdjustment) {
          lowestIdx = i;
        }
      }
      recs[lowestIdx].targetAdjustment = 0;
      console.log(`[Placements] Campaign ${campaignId}: Forced ${recs[lowestIdx].placement} to 0% (all placements had > 0% - keyword bids may be too low)`);
    }

    for (const rec of recs) {
      if (rec.targetAdjustment === rec.currentAdjustment) continue;

      const wasForced = allAboveZero && recs.length >= 3 && rec.targetAdjustment === 0;
      const reasonSuffix = wasForced ? ' [Forced to 0% - consider increasing keyword bids]' : '';

      await saveRecommendation({
        country,
        campaign_id: rec.campaign_id,
        campaign_name: rec.campaign_name,
        targeting: rec.placement,
        match_type: 'placement',
        recommendation_type: recommendationType,
        old_value: rec.currentAdjustment,
        recommended_value: rec.targetAdjustment,
        weighted_acos: rec.acos / 100,
        acos_target: rec.targetAcos / 100,
        pre_clicks_lifetime: Math.round(rec.clicks),
        confidence: rec.confidence,
        reason: `Placement ACOS (${rec.acos === 999 ? 'No Sales' : rec.acos.toFixed(1) + '%'}) ${rec.action === 'decrease' ? 'exceeds' : 'below'} target range (${(rec.targetAcos - acosWindow).toFixed(0)}%-${(rec.targetAcos + acosWindow).toFixed(0)}%). Adjust from ${rec.currentAdjustment}% to ${rec.targetAdjustment}%${reasonSuffix}`
      });

      savedCount++;
    }
  }

  return savedCount;
}

// Generate product placement recommendations using bid_adjustment_pct from s_products_placement
async function generateProductPlacementRecommendationsForCountry(country: string, connectionUrl: string): Promise<number> {
  const sqlClient = postgres(connectionUrl);
  const MIN_CLICKS = 30;
  const ACOS_WINDOW = 10;

  try {
    const acosTargetsResult = await sqlClient`
      SELECT campaign_id, acos_target, campaign_name
      FROM "ACOS_Target_Campaign"
      WHERE country = ${country}
    `;
    const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

    if (acosTargetsMap.size === 0) {
      return 0;
    }

    // Query placement performance data (T0 filtered: only data from last campaign change onwards)
    const placementData = await sqlClient`
      WITH campaign_t0 AS (
        SELECT campaign_id, last_change_date
        FROM s_campaign_t0
        WHERE country = ${country}
      )
      SELECT
        p."campaignId" as campaign_id,
        p."campaignName" as campaign_name,
        p."placementClassification" as placement,
        MAX(ct.last_change_date::text) as last_change_date,
        SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
             THEN COALESCE(NULLIF(p.clicks, '')::numeric, 0) ELSE 0 END) as clicks,
        SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
             THEN COALESCE(NULLIF(p.cost, '')::numeric, 0) ELSE 0 END) as cost,
        SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
             THEN COALESCE(NULLIF(p."sales30d", '')::numeric, 0) ELSE 0 END) as sales,
        SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
             THEN COALESCE(NULLIF(p."purchases30d", '')::numeric, 0) ELSE 0 END) as orders
      FROM "s_products_placement" p
      LEFT JOIN campaign_t0 ct ON p."campaignId"::text = ct.campaign_id
      WHERE p.country = ${country}
        AND p."placementClassification" IS NOT NULL
      GROUP BY p."campaignId", p."campaignName", p."placementClassification"
      HAVING SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
                  THEN COALESCE(NULLIF(p.clicks, '')::numeric, 0) ELSE 0 END) >= ${MIN_CLICKS}
      ORDER BY SUM(CASE WHEN ct.last_change_date IS NULL OR p.date >= ct.last_change_date
                    THEN COALESCE(NULLIF(p.cost, '')::numeric, 0) ELSE 0 END) DESC
    `;

    // Get latest bid_adjustment_pct per campaign+placement from the placement table itself
    const bidAdjMap = new Map<string, number>();
    const colCheck = await sqlClient`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 's_products_placement' AND column_name = 'bid_adjustment_pct'
    `;
    if (colCheck.length > 0) {
      const latestBidAdj = await sqlClient`
        SELECT DISTINCT ON ("campaignId", "placementClassification")
          "campaignId"::text as campaign_id,
          "placementClassification" as placement,
          COALESCE(NULLIF(bid_adjustment_pct, '')::numeric, 0) as bid_adj
        FROM s_products_placement
        WHERE country = ${country}
          AND "placementClassification" IS NOT NULL
          AND bid_adjustment_pct IS NOT NULL AND bid_adjustment_pct != ''
        ORDER BY "campaignId", "placementClassification", date DESC
      `;
      for (const row of latestBidAdj) {
        bidAdjMap.set(`${row.campaign_id}|${row.placement}`, Number(row.bid_adj));
      }
      console.log(`[Product Placements] Found ${latestBidAdj.length} bid_adjustment_pct values from s_products_placement for ${country}`);
    }

    // Build rows with current adjustment from bid_adjustment_pct
    const rows: PlacementPerformanceRow[] = placementData.map((p: any) => ({
      campaign_id: p.campaign_id,
      campaign_name: p.campaign_name,
      placement: p.placement,
      clicks: Number(p.clicks),
      cost: Number(p.cost),
      sales: Number(p.sales),
      orders: Number(p.orders),
      currentAdjustment: bidAdjMap.get(`${p.campaign_id}|${p.placement}`) ?? 0,
      lastChangeDate: p.last_change_date || undefined
    }));

    const savedCount = await processPlacementRecommendations(rows, acosTargetsMap, country, 'placement_adjustment', MIN_CLICKS, ACOS_WINDOW);
    console.log(`[Product Placements] ${country}: ${savedCount} recommendations saved`);
    return savedCount;
  } finally {
    await sqlClient.end();
  }
}

// Keep backward-compatible name for the product placement function
const generatePlacementRecommendationsForCountry = generateProductPlacementRecommendationsForCountry;

// Generate brand placement recommendations using bid_adjustment_pct from s_brand_placement
async function generateBrandPlacementRecommendationsForCountry(country: string, connectionUrl: string): Promise<number> {
  const sqlClient = postgres(connectionUrl);
  const MIN_CLICKS = 30;
  const ACOS_WINDOW = 10;

  try {
    const acosTargetsResult = await sqlClient`
      SELECT campaign_id, acos_target, campaign_name
      FROM "ACOS_Target_Campaign"
      WHERE country = ${country}
    `;
    const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

    if (acosTargetsMap.size === 0) {
      return 0;
    }

    // Dynamically detect column names in s_brand_placement
    const brandCols = await sqlClient`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 's_brand_placement'
    `;
    const brandColNames = new Set(brandCols.map((c: any) => c.column_name));

    if (brandColNames.size === 0) {
      console.log(`[Brand Placements] s_brand_placement table not found for ${country}`);
      return 0;
    }

    // Detect column names — the table may use camelCase or snake_case
    const campaignIdCol = brandColNames.has('campaignId') ? '"campaignId"' : 'campaign_id';
    const campaignNameCol = brandColNames.has('campaignName') ? '"campaignName"' : 'campaign_name';
    const hasPlacementClassification = brandColNames.has('placement_classification');
    const placementCol = hasPlacementClassification ? "COALESCE(placement_classification, 'Brand')" : "'Brand'";
    const salesCol = brandColNames.has('sales_14d') ? 'sales_14d' : (brandColNames.has('sales') ? 'sales' : '0');
    const purchasesCol = brandColNames.has('purchases_14d') ? 'purchases_14d' : (brandColNames.has('purchases') ? 'purchases' : '0');
    const hasBidAdj = brandColNames.has('bid_adjustment_pct');

    // Build GROUP BY clause
    const groupByCols = hasPlacementClassification
      ? `${campaignIdCol}, ${campaignNameCol}, placement_classification`
      : `${campaignIdCol}, ${campaignNameCol}`;

    // Query aggregated brand placement performance (T0 filtered)
    const placementData = await sqlClient.unsafe(`
      WITH campaign_t0 AS (
        SELECT campaign_id, last_change_date
        FROM s_campaign_t0
        WHERE country = $1
      )
      SELECT
        sb.${campaignIdCol}::text as campaign_id,
        sb.${campaignNameCol} as campaign_name,
        ${hasPlacementClassification ? "COALESCE(sb.placement_classification, 'Brand')" : "'Brand'"} as placement,
        MAX(ct.last_change_date::text) as last_change_date,
        COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.clicks ELSE 0 END), 0) as clicks,
        COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.cost::numeric ELSE 0 END), 0) as cost,
        COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.${salesCol}::numeric ELSE 0 END), 0) as sales,
        COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.${purchasesCol}::numeric ELSE 0 END), 0) as orders
      FROM s_brand_placement sb
      LEFT JOIN campaign_t0 ct ON sb.${campaignIdCol}::text = ct.campaign_id
      WHERE sb.country = $1
        ${hasPlacementClassification ? "AND sb.placement_classification IS NOT NULL" : ""}
      GROUP BY sb.${campaignIdCol}, sb.${campaignNameCol}${hasPlacementClassification ? ", sb.placement_classification" : ""}
      HAVING COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.clicks ELSE 0 END), 0) >= $2
      ORDER BY COALESCE(SUM(CASE WHEN ct.last_change_date IS NULL OR sb.date >= ct.last_change_date THEN sb.cost::numeric ELSE 0 END), 0) DESC
    `, [country, MIN_CLICKS]);

    // Get latest bid_adjustment_pct per campaign+placement
    const bidAdjMap = new Map<string, number>();
    if (hasBidAdj) {
      const distinctOnCols = hasPlacementClassification
        ? `${campaignIdCol}, placement_classification`
        : campaignIdCol;
      const orderByCols = hasPlacementClassification
        ? `${campaignIdCol}, placement_classification, date DESC`
        : `${campaignIdCol}, date DESC`;

      const latestBidAdj = await sqlClient.unsafe(`
        SELECT DISTINCT ON (${distinctOnCols})
          ${campaignIdCol}::text as campaign_id,
          ${placementCol} as placement,
          COALESCE(bid_adjustment_pct::numeric, 0) as bid_adj
        FROM s_brand_placement
        WHERE country = $1
          AND bid_adjustment_pct IS NOT NULL
        ORDER BY ${orderByCols}
      `, [country]);

      for (const row of latestBidAdj) {
        bidAdjMap.set(`${row.campaign_id}|${row.placement}`, Number(row.bid_adj));
      }
      console.log(`[Brand Placements] Found ${latestBidAdj.length} bid_adjustment_pct values from s_brand_placement for ${country}`);
    }

    // Build rows with current adjustment from bid_adjustment_pct
    const rows: PlacementPerformanceRow[] = placementData.map((p: any) => ({
      campaign_id: p.campaign_id,
      campaign_name: p.campaign_name,
      placement: p.placement,
      clicks: Number(p.clicks),
      cost: Number(p.cost),
      sales: Number(p.sales),
      orders: Number(p.orders),
      currentAdjustment: bidAdjMap.get(`${p.campaign_id}|${p.placement}`) ?? 0,
      lastChangeDate: p.last_change_date || undefined
    }));

    const savedCount = await processPlacementRecommendations(rows, acosTargetsMap, country, 'brand_placement_adjustment', MIN_CLICKS, ACOS_WINDOW);
    console.log(`[Brand Placements] ${country}: ${savedCount} recommendations saved`);
    return savedCount;
  } finally {
    await sqlClient.end();
  }
}
