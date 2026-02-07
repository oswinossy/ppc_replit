/**
 * Audience Bid Adjustment Sync
 *
 * Combines two data sources for each profile:
 *   1. SP Campaigns API → shopperCohortBidding (bid adjustment %)
 *   2. spAudiences Report → performance metrics per campaign/segment
 *
 * Joined on campaignId, then upserted into the audience_bid_adjustment table.
 */

import { db } from '../db';
import { audienceBidAdjustment } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { getAmazonAdsClient } from '../amazonAdsClient';

interface BidAdjustmentMap {
  [campaignId: string]: {
    audienceId: string;
    percentage: number;
    audienceType: string;
  };
}

interface AudienceSyncResult {
  country: string;
  reportRows: number;
  insertedRows: number;
  campaignsWithAudiences: number;
}

export interface FullAudienceSyncResult {
  countriesSynced: string[];
  results: AudienceSyncResult[];
  totalRows: number;
  startDate: string;
  endDate: string;
}

/**
 * Extract audience bid adjustment info from SP campaign objects.
 * Returns a map of campaignId → { audienceId, percentage, audienceType }.
 */
function extractBidAdjustments(campaigns: any[]): BidAdjustmentMap {
  const map: BidAdjustmentMap = {};

  for (const campaign of campaigns) {
    const cohortBidding = campaign.dynamicBidding?.shopperCohortBidding;
    if (!cohortBidding || !Array.isArray(cohortBidding)) continue;

    for (const cohort of cohortBidding) {
      if (cohort.shopperCohortType === 'AUDIENCE_SEGMENT' && cohort.audienceSegments?.length) {
        const seg = cohort.audienceSegments[0];
        map[String(campaign.campaignId)] = {
          audienceId: String(seg.audienceId || ''),
          percentage: cohort.percentage || 0,
          audienceType: seg.audienceSegmentType || 'UNKNOWN',
        };
      }
    }
  }

  return map;
}

/**
 * Sync audience bid adjustment data for all configured profiles (or a single country).
 */
export async function syncAudienceBidData(
  startDate?: string,
  endDate?: string,
  country?: string,
): Promise<FullAudienceSyncResult> {
  const client = getAmazonAdsClient();
  if (!client) {
    throw new Error('Amazon Ads client not configured');
  }

  // Default to a single day if not specified
  const sd = startDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const ed = endDate || sd;

  const profiles = client.getProfiles();
  const targetProfiles = country
    ? profiles.filter(p => p.country.toUpperCase() === country.toUpperCase())
    : profiles;

  if (targetProfiles.length === 0) {
    throw new Error(`No profiles found for country: ${country}`);
  }

  const results: AudienceSyncResult[] = [];
  let totalRows = 0;

  for (const profile of targetProfiles) {
    console.log(`[AudienceSync] Processing ${profile.country} (profile ${profile.profileId})...`);

    try {
      // Step 1: Fetch SP campaigns with bid adjustment settings
      console.log(`[AudienceSync] ${profile.country}: Fetching SP campaigns...`);
      const campaigns = await client.listSpCampaigns(profile.profileId);
      const bidMap = extractBidAdjustments(campaigns);
      const campaignsWithAudiences = Object.keys(bidMap).length;
      console.log(`[AudienceSync] ${profile.country}: ${campaigns.length} campaigns, ${campaignsWithAudiences} with audience bid adjustments`);

      // Step 2: Fetch spAudiences report
      console.log(`[AudienceSync] ${profile.country}: Requesting audience report (${sd} → ${ed})...`);
      let reportRows: any[];
      try {
        reportRows = await client.fetchAudienceReport(profile.profileId, sd, ed);
      } catch (err: any) {
        console.warn(`[AudienceSync] ${profile.country}: Audience report failed: ${err.message}`);
        reportRows = [];
      }
      console.log(`[AudienceSync] ${profile.country}: ${reportRows.length} report rows`);

      if (reportRows.length === 0) {
        results.push({ country: profile.country, reportRows: 0, insertedRows: 0, campaignsWithAudiences });
        continue;
      }

      // Step 3: Join report data with bid adjustment settings
      const rows = reportRows.map(row => {
        const campaignId = String(row.campaignId || '');
        const bidInfo = bidMap[campaignId];

        return {
          country: profile.country,
          profileId: profile.profileId,
          campaignId,
          campaignName: row.campaignName || null,
          campaignStatus: row.campaignStatus || null,
          segmentName: row.segmentName || null,
          segmentClassCode: row.segmentClassCode || null,
          audienceId: bidInfo?.audienceId || null,
          bidAdjustmentPct: bidInfo?.percentage ?? null,
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          cost: String(row.cost || '0'),
          costPerClick: row.costPerClick != null ? String(row.costPerClick) : null,
          clickThroughRate: row.clickThroughRate != null ? String(row.clickThroughRate) : null,
          purchases7d: Number(row.purchases7d) || 0,
          sales7d: String(row.sales7d || '0'),
          purchases14d: Number(row.purchases14d) || 0,
          sales14d: String(row.sales14d || '0'),
          reportStartDate: sd,
          reportEndDate: ed,
        };
      });

      // Step 4: Insert in batches via raw SQL upsert
      const BATCH_SIZE = 100;
      let insertedRows = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        for (const row of batch) {
          await db.execute(sql`
            INSERT INTO audience_bid_adjustment (
              country, profile_id, campaign_id, campaign_name, campaign_status,
              segment_name, segment_class_code, audience_id, bid_adjustment_pct,
              impressions, clicks, cost, cost_per_click, click_through_rate,
              purchases_7d, sales_7d, purchases_14d, sales_14d,
              report_start_date, report_end_date, synced_at
            ) VALUES (
              ${row.country}, ${row.profileId}, ${row.campaignId}, ${row.campaignName}, ${row.campaignStatus},
              ${row.segmentName}, ${row.segmentClassCode}, ${row.audienceId}, ${row.bidAdjustmentPct},
              ${row.impressions}, ${row.clicks}, ${row.cost}, ${row.costPerClick}, ${row.clickThroughRate},
              ${row.purchases7d}, ${row.sales7d}, ${row.purchases14d}, ${row.sales14d},
              ${row.reportStartDate}, ${row.reportEndDate}, NOW()
            )
            ON CONFLICT (country, campaign_id, segment_name, report_start_date, report_end_date)
            DO UPDATE SET
              campaign_name = EXCLUDED.campaign_name,
              campaign_status = EXCLUDED.campaign_status,
              segment_class_code = EXCLUDED.segment_class_code,
              audience_id = EXCLUDED.audience_id,
              bid_adjustment_pct = EXCLUDED.bid_adjustment_pct,
              impressions = EXCLUDED.impressions,
              clicks = EXCLUDED.clicks,
              cost = EXCLUDED.cost,
              cost_per_click = EXCLUDED.cost_per_click,
              click_through_rate = EXCLUDED.click_through_rate,
              purchases_7d = EXCLUDED.purchases_7d,
              sales_7d = EXCLUDED.sales_7d,
              purchases_14d = EXCLUDED.purchases_14d,
              sales_14d = EXCLUDED.sales_14d,
              synced_at = NOW()
          `);
          insertedRows++;
        }
      }

      totalRows += insertedRows;
      results.push({
        country: profile.country,
        reportRows: reportRows.length,
        insertedRows,
        campaignsWithAudiences,
      });

      console.log(`[AudienceSync] ${profile.country}: Done — ${insertedRows} rows upserted`);

    } catch (err: any) {
      console.error(`[AudienceSync] ${profile.country}: Error — ${err.message}`);
      results.push({ country: profile.country, reportRows: 0, insertedRows: 0, campaignsWithAudiences: 0 });
    }
  }

  return {
    countriesSynced: results.filter(r => r.insertedRows > 0).map(r => r.country),
    results,
    totalRows,
    startDate: sd,
    endDate: ed,
  };
}
