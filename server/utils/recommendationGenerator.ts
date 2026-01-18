import postgres from 'postgres';
import { getWeightsForCountry, saveRecommendation } from '../migrations/biddingStrategy';

const COUNTRIES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL', 'SE', 'UK', 'US'];

export async function generateDailyRecommendations(): Promise<{ total: number; countries: number }> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  let totalRecommendations = 0;
  let countriesProcessed = 0;

  for (const country of COUNTRIES) {
    try {
      const count = await generateRecommendationsForCountry(country, connectionUrl);
      if (count > 0) {
        totalRecommendations += count;
        countriesProcessed++;
        console.log(`[RecommendationGenerator] ${country}: ${count} recommendations generated`);
      }
    } catch (error) {
      console.error(`[RecommendationGenerator] Error processing ${country}:`, error);
    }
  }

  return { total: totalRecommendations, countries: countriesProcessed };
}

async function generateRecommendationsForCountry(country: string, connectionUrl: string): Promise<number> {
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
