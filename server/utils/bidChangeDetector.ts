import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface BidChangeResult {
  products: number;
  brands: number;
  total: number;
}

export async function detectBidChanges(): Promise<BidChangeResult> {
  let totalChangesDetected = 0;

  const productChanges = await db.execute(sql`
    WITH bid_changes AS (
      SELECT 
        'products' as campaign_type,
        curr.targeting,
        curr."campaignId" as campaign_id,
        curr."adGroupId" as ad_group_id,
        MAX(curr."campaignName") as campaign_name,
        MAX(curr."adGroupName") as ad_group_name,
        curr.country,
        curr.date::date as date_adjusted,
        curr."keywordBid" as current_bid,
        prev."keywordBid" as previous_bid,
        MAX(curr."matchType") as match_type
      FROM "s_products_search_terms" curr
      INNER JOIN "s_products_search_terms" prev 
        ON curr.targeting = prev.targeting
        AND curr."campaignId" = prev."campaignId"
        AND curr."adGroupId" IS NOT DISTINCT FROM prev."adGroupId"
        AND curr.date::date = prev.date::date + INTERVAL '1 day'
      WHERE curr."keywordBid" IS NOT NULL 
        AND prev."keywordBid" IS NOT NULL
        AND curr."keywordBid" != prev."keywordBid"
      GROUP BY curr.targeting, curr."campaignId", curr."adGroupId", curr.country, 
               curr.date, curr."keywordBid", prev."keywordBid"
    )
    INSERT INTO bid_change_history 
      (campaign_type, targeting, campaign_id, ad_group_id, campaign_name, ad_group_name, 
       country, date_adjusted, current_bid, previous_bid, match_type)
    SELECT 
      campaign_type, targeting, campaign_id, ad_group_id, campaign_name, ad_group_name,
      country, date_adjusted, current_bid, previous_bid, match_type
    FROM bid_changes bc
    WHERE NOT EXISTS (
      SELECT 1 FROM bid_change_history bch
      WHERE bch.campaign_type = bc.campaign_type
        AND bch.targeting = bc.targeting
        AND bch.campaign_id = bc.campaign_id
        AND bch.ad_group_id IS NOT DISTINCT FROM bc.ad_group_id
        AND bch.date_adjusted = bc.date_adjusted
    )
    RETURNING id
  `);

  const productResult = productChanges as any;
  const productCount = productResult?.length ?? productResult?.rowCount ?? 0;
  totalChangesDetected += productCount;

  const brandChanges = await db.execute(sql`
    WITH bid_changes AS (
      SELECT 
        'brands' as campaign_type,
        curr.keyword_text as targeting,
        curr.campaign_id,
        curr.ad_group_id,
        MAX(curr.campaign_name) as campaign_name,
        MAX(curr.ad_group_name) as ad_group_name,
        curr.country,
        curr.date::date as date_adjusted,
        curr.keyword_bid as current_bid,
        prev.keyword_bid as previous_bid,
        MAX(curr.match_type) as match_type
      FROM "s_brand_search_terms" curr
      INNER JOIN "s_brand_search_terms" prev 
        ON curr.keyword_text = prev.keyword_text
        AND curr.campaign_id = prev.campaign_id
        AND curr.ad_group_id IS NOT DISTINCT FROM prev.ad_group_id
        AND curr.date::date = prev.date::date + INTERVAL '1 day'
      WHERE curr.keyword_bid IS NOT NULL 
        AND prev.keyword_bid IS NOT NULL
        AND curr.keyword_bid != prev.keyword_bid
      GROUP BY curr.keyword_text, curr.campaign_id, curr.ad_group_id, curr.country,
               curr.date, curr.keyword_bid, prev.keyword_bid
    )
    INSERT INTO bid_change_history 
      (campaign_type, targeting, campaign_id, ad_group_id, campaign_name, ad_group_name,
       country, date_adjusted, current_bid, previous_bid, match_type)
    SELECT 
      campaign_type, targeting, campaign_id, ad_group_id, campaign_name, ad_group_name,
      country, date_adjusted, current_bid, previous_bid, match_type
    FROM bid_changes bc
    WHERE NOT EXISTS (
      SELECT 1 FROM bid_change_history bch
      WHERE bch.campaign_type = bc.campaign_type
        AND bch.targeting = bc.targeting
        AND bch.campaign_id = bc.campaign_id
        AND bch.ad_group_id IS NOT DISTINCT FROM bc.ad_group_id
        AND bch.date_adjusted = bc.date_adjusted
    )
    RETURNING id
  `);

  const brandResult = brandChanges as any;
  const brandCount = brandResult?.length ?? brandResult?.rowCount ?? 0;
  totalChangesDetected += brandCount;

  return {
    products: productCount,
    brands: brandCount,
    total: totalChangesDetected
  };
}
