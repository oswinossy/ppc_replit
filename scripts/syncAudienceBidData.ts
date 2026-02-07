/**
 * Standalone script to sync audience bid adjustment data.
 *
 * Uses:
 *   - Amazon Ads API (HTTPS) for campaign data + audience reports
 *   - Supabase REST API (HTTPS) for inserting data
 *
 * This avoids TCP database connections, making it runnable from
 * environments where only HTTPS is available.
 *
 * Usage: npx tsx scripts/syncAudienceBidData.ts [startDate] [endDate]
 * Example: npx tsx scripts/syncAudienceBidData.ts 2026-01-23 2026-01-23
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADS_CLIENT_ID = process.env.AMAZON_ADS_CLIENT_ID!;
const ADS_CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET!;
const ADS_REFRESH_TOKEN = process.env.AMAZON_ADS_REFRESH_TOKEN!;
const ADS_REGION = (process.env.AMAZON_ADS_REGION || 'eu') as string;
const ADS_PROFILE_IDS = JSON.parse(process.env.AMAZON_ADS_PROFILE_IDS || '{}') as Record<string, string>;

const REGIONAL_ENDPOINTS: Record<string, string> = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
};

const TOKEN_URLS: Record<string, string> = {
  na: 'https://api.amazon.com/auth/o2/token',
  eu: 'https://api.amazon.co.uk/auth/o2/token',
  fe: 'https://api.amazon.co.jp/auth/o2/token',
};

const BASE_URL = REGIONAL_ENDPOINTS[ADS_REGION];
const TOKEN_URL = TOKEN_URLS[ADS_REGION];

let cachedToken: { token: string; expiresAt: number } | null = null;

// ─── Amazon Ads Auth ──────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  console.log('[Auth] Refreshing access token...');
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ADS_REFRESH_TOKEN,
      client_id: ADS_CLIENT_ID,
      client_secret: ADS_CLIENT_SECRET,
    }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json() as any;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function apiHeaders(profileId: string): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': ADS_CLIENT_ID,
    'Amazon-Advertising-API-Scope': profileId,
    'Content-Type': 'application/json',
  };
}

// ─── Fetch SP Campaigns (with bid adjustments) ───────────────────────────────

async function fetchSpCampaigns(profileId: string): Promise<any[]> {
  const headers = await apiHeaders(profileId);
  headers['Content-Type'] = 'application/vnd.spCampaign.v3+json';
  headers['Accept'] = 'application/vnd.spCampaign.v3+json';

  const allCampaigns: any[] = [];
  let nextToken: string | null = null;

  do {
    const body: any = { maxResults: 100 };
    if (nextToken) body.nextToken = nextToken;

    const resp = await fetch(`${BASE_URL}/sp/campaigns/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`SP campaigns failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as any;
    allCampaigns.push(...(data.campaigns || []));
    nextToken = data.nextToken || null;
  } while (nextToken);

  return allCampaigns;
}

// ─── Extract bid adjustment map ───────────────────────────────────────────────

function extractBidAdjustments(campaigns: any[]): Record<string, { audienceId: string; percentage: number }> {
  const map: Record<string, { audienceId: string; percentage: number }> = {};

  for (const c of campaigns) {
    const cohorts = c.dynamicBidding?.shopperCohortBidding;
    if (!cohorts || !Array.isArray(cohorts)) continue;

    for (const cohort of cohorts) {
      if (cohort.shopperCohortType === 'AUDIENCE_SEGMENT' && cohort.audienceSegments?.length) {
        map[String(c.campaignId)] = {
          audienceId: String(cohort.audienceSegments[0].audienceId || ''),
          percentage: cohort.percentage || 0,
        };
      }
    }
  }

  return map;
}

// ─── Fetch spAudiences Report ─────────────────────────────────────────────────

async function fetchAudienceReport(profileId: string, startDate: string, endDate: string): Promise<any[]> {
  const headers = await apiHeaders(profileId);

  // Request report
  const resp = await fetch(`${BASE_URL}/reporting/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'SP Audiences Report',
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign_bid_boost_segment'],
        columns: [
          'startDate', 'endDate',
          'campaignName', 'campaignId', 'campaignStatus',
          'segmentName', 'segmentClassCode',
          'impressions', 'clicks', 'cost', 'costPerClick', 'clickThroughRate',
          'purchases7d', 'sales7d', 'purchases14d', 'sales14d',
        ],
        reportTypeId: 'spAudiences',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    }),
  });

  if (!resp.ok) throw new Error(`Audience report request failed: ${await resp.text()}`);
  const { reportId } = await resp.json() as any;
  console.log(`  Report queued: ${reportId}`);

  // Poll until completed
  const maxWait = 600_000;
  const started = Date.now();
  while (Date.now() - started < maxWait) {
    const pollHeaders = await apiHeaders(profileId);
    const pollResp = await fetch(`${BASE_URL}/reporting/reports/${reportId}`, { headers: pollHeaders });
    if (!pollResp.ok) throw new Error(`Report poll failed: ${await pollResp.text()}`);

    const data = await pollResp.json() as any;
    if (data.status === 'COMPLETED' && data.url) {
      console.log(`  Report ready (${data.fileSize} bytes)`);
      // Download
      const dlResp = await fetch(data.url);
      const text = await dlResp.text();
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      }
    }
    if (data.status === 'FAILED') throw new Error(`Report failed: ${data.failureReason}`);

    const elapsed = Date.now() - started;
    const delay = Math.min(5000 * Math.pow(2, Math.floor(elapsed / 15000)), 30000);
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, delay));
  }

  throw new Error(`Report ${reportId} timed out`);
}

// ─── Insert via Supabase REST API ─────────────────────────────────────────────

async function upsertRows(rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;

  // Supabase REST upsert (on conflict merge)
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/audience_bid_adjustment`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase insert failed (${resp.status}): ${text}`);
  }

  return rows.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const startDate = args[0] || new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
  const endDate = args[1] || startDate;

  console.log(`\nAudience Bid Adjustment Sync`);
  console.log(`Date range: ${startDate} → ${endDate}`);
  console.log(`Profiles: ${Object.keys(ADS_PROFILE_IDS).join(', ')}\n`);

  let totalInserted = 0;

  for (const [country, profileId] of Object.entries(ADS_PROFILE_IDS)) {
    console.log(`\n── ${country} (profile ${profileId}) ──`);

    try {
      // Step 1: Get campaigns with bid adjustments
      console.log('  Fetching SP campaigns...');
      const campaigns = await fetchSpCampaigns(profileId);
      const bidMap = extractBidAdjustments(campaigns);
      console.log(`  ${campaigns.length} campaigns, ${Object.keys(bidMap).length} with audience bid adjustments`);

      // Step 2: Fetch audience report
      console.log(`  Requesting audience report...`);
      let reportRows: any[];
      try {
        reportRows = await fetchAudienceReport(profileId, startDate, endDate);
      } catch (err: any) {
        console.log(`  Audience report failed (may have no data): ${err.message}`);
        reportRows = [];
      }
      console.log(`  ${reportRows.length} report rows`);

      if (reportRows.length === 0) continue;

      // Step 3: Join and prepare rows
      const rows = reportRows.map(row => {
        const cid = String(row.campaignId || '');
        const bid = bidMap[cid];
        return {
          country,
          profile_id: profileId,
          campaign_id: cid,
          campaign_name: row.campaignName || null,
          campaign_status: row.campaignStatus || null,
          segment_name: row.segmentName || null,
          segment_class_code: row.segmentClassCode || null,
          audience_id: bid?.audienceId || null,
          bid_adjustment_pct: bid?.percentage ?? null,
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          cost: Number(row.cost) || 0,
          cost_per_click: row.costPerClick != null ? Number(row.costPerClick) : null,
          click_through_rate: row.clickThroughRate != null ? Number(row.clickThroughRate) : null,
          purchases_7d: Number(row.purchases7d) || 0,
          sales_7d: Number(row.sales7d) || 0,
          purchases_14d: Number(row.purchases14d) || 0,
          sales_14d: Number(row.sales14d) || 0,
          report_start_date: startDate,
          report_end_date: endDate,
        };
      });

      // Step 4: Upsert in batches
      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const inserted = await upsertRows(batch);
        totalInserted += inserted;
      }

      console.log(`  ${rows.length} rows upserted`);
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log(`\n✓ Done! Total rows upserted: ${totalInserted}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
