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
      const placementCount = await generatePlacementRecommendationsForCountry(country, connectionUrl);
      
      if (keywordCount > 0 || placementCount > 0) {
        totalKeywords += keywordCount;
        totalPlacements += placementCount;
        countriesProcessed++;
        console.log(`[RecommendationGenerator] ${country}: ${keywordCount} keyword + ${placementCount} placement recommendations`);
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
  const placementCount = await generatePlacementRecommendationsForCountry(country, connectionUrl);
  
  console.log(`[RecommendationGenerator] ${country}: ${keywordCount} keyword + ${placementCount} placement recommendations`);
  
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
      WITH last_changes AS (
        SELECT 
          targeting,
          campaign_id,
          ad_group_id,
          MAX(date_adjusted) as last_change_date
        FROM "bid_change_history"
        WHERE country = ${country}
        GROUP BY targeting, campaign_id, ad_group_id
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
          lc.last_change_date::text as last_change_date
        FROM "s_products_search_terms" s
        LEFT JOIN last_changes lc 
          ON s."campaignId"::text = lc.campaign_id::text 
          AND s.keyword = lc.targeting 
          AND s."adGroupId"::text = lc.ad_group_id::text
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
        SUM(CASE WHEN date >= ${d30AgoStr} THEN clicks ELSE 0 END) as d30_clicks,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN cost ELSE 0 END) as d30_cost,
        SUM(CASE WHEN date >= ${d30AgoStr} THEN sales ELSE 0 END) as d30_sales,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN clicks ELSE 0 END) as t0_clicks,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN cost ELSE 0 END) as t0_cost,
        SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN sales ELSE 0 END) as t0_sales
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
        pre_clicks_t0: t0Clicks,
        pre_clicks_30d: Number(kw.d30_clicks),
        pre_clicks_365d: Number(kw.d365_clicks),
        pre_clicks_lifetime: totalClicks,
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

async function generatePlacementRecommendationsForCountry(country: string, connectionUrl: string): Promise<number> {
  const sqlClient = postgres(connectionUrl);
  const MIN_CLICKS = 30; // Same as keyword recommendations
  const ACOS_WINDOW = 10; // ±10% window for placements
  
  try {
    // Get ACOS targets for campaigns in this country
    const acosTargetsResult = await sqlClient`
      SELECT campaign_id, acos_target, campaign_name 
      FROM "ACOS_Target_Campaign" 
      WHERE country = ${country}
    `;
    const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

    if (acosTargetsMap.size === 0) {
      return 0;
    }

    // Query placement data grouped by campaign (minimum 30 clicks same as keywords)
    // Note: placementBidAdjustment and campaignBiddingStrategy not available in raw data
    const placementData = await sqlClient`
      SELECT 
        "campaignId" as campaign_id,
        "campaignName" as campaign_name,
        "placementClassification" as placement,
        SUM(COALESCE(NULLIF(impressions, '')::numeric, 0)) as impressions,
        SUM(COALESCE(NULLIF(clicks, '')::numeric, 0)) as clicks,
        SUM(COALESCE(NULLIF(cost, '')::numeric, 0)) as cost,
        SUM(COALESCE(NULLIF("sales30d", '')::numeric, 0)) as sales,
        SUM(COALESCE(NULLIF("purchases30d", '')::numeric, 0)) as orders
      FROM "s_products_placement"
      WHERE country = ${country}
        AND "placementClassification" IS NOT NULL
      GROUP BY "campaignId", "campaignName", "placementClassification"
      HAVING SUM(COALESCE(NULLIF(clicks, '')::numeric, 0)) >= ${MIN_CLICKS}
      ORDER BY SUM(COALESCE(NULLIF(cost, '')::numeric, 0)) DESC
    `;

    let savedCount = 0;

    for (const p of placementData) {
      const campaignTarget = acosTargetsMap.get(p.campaign_id);
      if (!campaignTarget) continue;

      const targetAcos = campaignTarget.target * 100; // Convert to percentage
      const clicks = Number(p.clicks);
      const cost = Number(p.cost);
      const sales = Number(p.sales);
      const currentAdjustment = 0; // Default - actual value not in raw data
      
      if (clicks < MIN_CLICKS) continue;
      
      // Calculate ACOS (999 = high clicks but no sales = problem)
      const acos = sales > 0 ? (cost / sales) * 100 : (clicks >= MIN_CLICKS ? 999 : null);
      if (acos === null) continue;

      // FIRST check: Skip if ACOS is within target window (±10%)
      // Only generate recommendation if ACOS is OUTSIDE the target range
      if (acos !== 999 && acos >= targetAcos - ACOS_WINDOW && acos <= targetAcos + ACOS_WINDOW) {
        continue; // Within acceptable range, no adjustment needed
      }

      // Calculate target bid adjustment based on ACOS performance
      let targetAdjustment: number | null = null;
      
      if (acos !== 999 && acos > 0) {
        // Adjustment multiplier based on ACOS vs target
        const multiplier = targetAcos / acos;
        
        // Calculate new adjustment
        // If ACOS is 2x target, we reduce adjustment by 50%
        // If ACOS is 0.5x target, we increase adjustment by 50%
        const adjustmentChange = Math.round((multiplier - 1) * 50);
        targetAdjustment = Math.max(-90, Math.min(900, currentAdjustment + adjustmentChange));
        
        // Round to nearest 5%
        targetAdjustment = Math.round(targetAdjustment / 5) * 5;
      } else if (acos === 999) {
        // High clicks, no sales - reduce adjustment significantly
        targetAdjustment = Math.max(-90, currentAdjustment - 25);
        targetAdjustment = Math.round(targetAdjustment / 5) * 5;
      }
      
      // Skip if adjustment is the same
      if (targetAdjustment === null || targetAdjustment === currentAdjustment) continue;

      // Determine confidence based on clicks (same thresholds as keywords)
      let confidence = 'Low';
      if (clicks >= 200) confidence = 'Extreme';
      else if (clicks >= 100) confidence = 'High';
      else if (clicks >= 50) confidence = 'Good';
      else if (clicks >= MIN_CLICKS) confidence = 'OK';

      const action = acos > targetAcos ? 'decrease' : 'increase';

      await saveRecommendation({
        country,
        campaign_id: p.campaign_id,
        campaign_name: p.campaign_name,
        targeting: p.placement,
        match_type: 'placement',
        recommendation_type: 'placement_adjustment',
        old_value: currentAdjustment,
        recommended_value: targetAdjustment,
        weighted_acos: acos / 100, // Store as decimal
        acos_target: campaignTarget.target,
        pre_clicks_lifetime: clicks,
        confidence,
        reason: `Placement ACOS (${acos === 999 ? 'No Sales' : acos.toFixed(1) + '%'}) ${action === 'decrease' ? 'exceeds' : 'below'} target range (${(targetAcos - ACOS_WINDOW).toFixed(0)}%-${(targetAcos + ACOS_WINDOW).toFixed(0)}%). Adjust from ${currentAdjustment}% to ${targetAdjustment}%`
      });
      
      savedCount++;
    }

    return savedCount;
  } finally {
    await sqlClient.end();
  }
}
