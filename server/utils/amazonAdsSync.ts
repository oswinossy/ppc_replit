/**
 * Amazon Ads Data Sync
 *
 * Pulls reports from the Amazon Advertising API (v3) and upserts
 * the rows into the existing Supabase PostgreSQL tables so the
 * analytics dashboard stays up-to-date automatically.
 *
 * Designed to run as a daily cron job (see scheduler.ts) or
 * triggered manually via POST /api/amazon-ads/sync.
 */

import { db } from '../db';
import { getAmazonAdsClient, type ReportRequest } from '../amazonAdsClient';
import {
  productSearchTerms,
  productPlacement,
  brandSearchTerms,
  brandPlacement,
  displayMatchedTarget,
  displayTargeting,
} from '@shared/schema';
import { sql } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncResult {
  reportType: string;
  rowsFetched: number;
  rowsInserted: number;
  error?: string;
}

interface FullSyncResult {
  success: boolean;
  startedAt: string;
  completedAt: string;
  results: SyncResult[];
  totalRows: number;
}

// ─── Country mapping ─────────────────────────────────────────────────────────

/**
 * Amazon marketplace IDs → country codes used in the existing schema.
 * The profile's countryCode from the API maps directly.
 */
function normalizeCountry(countryCode: string | undefined): string {
  if (!countryCode) return 'US';
  const map: Record<string, string> = {
    US: 'US', CA: 'CA', MX: 'MX', BR: 'BR',       // NA
    UK: 'UK', GB: 'UK', DE: 'DE', FR: 'FR',        // EU
    IT: 'IT', ES: 'ES', NL: 'NL', SE: 'SE',
    PL: 'PL', BE: 'BE', TR: 'TR',
    JP: 'JP', AU: 'AU', SG: 'SG', IN: 'IN',        // FE
    AE: 'AE', SA: 'SA',
  };
  return map[countryCode.toUpperCase()] || countryCode.toUpperCase();
}

// ─── Per-report-type insert logic ────────────────────────────────────────────

async function insertSpSearchTermRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    costPerClick: Number(r.costPerClick) || 0,
    clickThroughRate: Number(r.clickThroughRate) || 0,
    cost: Number(r.cost) || 0,
    spend: Number(r.cost) || 0,
    purchases1d: String(r.purchases1d ?? '0'),
    purchases7d: String(r.purchases7d ?? '0'),
    purchases14d: String(r.purchases14d ?? '0'),
    purchases30d: String(r.purchases30d ?? '0'),
    sales1d: String(r.sales1d ?? '0'),
    sales7d: String(r.sales7d ?? '0'),
    sales14d: String(r.sales14d ?? '0'),
    sales30d: String(r.sales30d ?? '0'),
    unitsSoldClicks1d: String(r.unitsSoldClicks1d ?? '0'),
    unitsSoldClicks7d: String(r.unitsSoldClicks7d ?? '0'),
    unitsSoldClicks14d: String(r.unitsSoldClicks14d ?? '0'),
    unitsSoldClicks30d: String(r.unitsSoldClicks30d ?? '0'),
    purchasesSameSku1d: String(r.purchasesSameSku1d ?? '0'),
    purchasesSameSku7d: String(r.purchasesSameSku7d ?? '0'),
    purchasesSameSku14d: String(r.purchasesSameSku14d ?? '0'),
    purchasesSameSku30d: String(r.purchasesSameSku30d ?? '0'),
    attributedSalesSameSku1d: String(r.attributedSalesSameSku1d ?? '0'),
    attributedSalesSameSku7d: String(r.attributedSalesSameSku7d ?? '0'),
    attributedSalesSameSku14d: String(r.attributedSalesSameSku14d ?? '0'),
    attributedSalesSameSku30d: String(r.attributedSalesSameSku30d ?? '0'),
    acosClicks7d: String(r.acosClicks7d ?? ''),
    acosClicks14d: String(r.acosClicks14d ?? ''),
    roasClicks7d: String(r.roasClicks7d ?? ''),
    roasClicks14d: String(r.roasClicks14d ?? ''),
    keywordId: r.keywordId ? Number(r.keywordId) : null,
    keyword: r.keyword ?? null,
    keywordBid: r.keywordBid ? Number(r.keywordBid) : null,
    keywordType: r.keywordType ?? null,
    matchType: r.matchType ?? null,
    searchTerm: r.searchTerm ?? null,
    targeting: r.targeting ?? null,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    campaignStatus: r.campaignStatus ?? null,
    campaignBudgetAmount: r.campaignBudgetAmount ?? null,
    campaignBudgetCurrencyCode: r.campaignBudgetCurrencyCode ?? null,
    campaignBudgetType: r.campaignBudgetType ?? null,
    adGroupId: r.adGroupId ? Number(r.adGroupId) : null,
    adGroupName: r.adGroupName ?? null,
    date: r.date ?? null,
    country,
    createdAt: new Date(),
  }));

  // Insert in batches of 500 to avoid query size limits
  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(productSearchTerms).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

async function insertSpPlacementRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    date: r.date ?? null,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    placementClassification: r.placementClassification ?? null,
    impressions: String(r.impressions ?? '0'),
    clicks: String(r.clicks ?? '0'),
    cost: String(r.cost ?? '0'),
    spend: String(r.cost ?? '0'),
    costPerClick: String(r.costPerClick ?? '0'),
    clickThroughRate: String(r.clickThroughRate ?? '0'),
    purchases1d: String(r.purchases1d ?? '0'),
    purchases7d: String(r.purchases7d ?? '0'),
    purchases14d: String(r.purchases14d ?? '0'),
    purchases30d: String(r.purchases30d ?? '0'),
    sales1d: String(r.sales1d ?? '0'),
    sales7d: String(r.sales7d ?? '0'),
    sales14d: String(r.sales14d ?? '0'),
    sales30d: String(r.sales30d ?? '0'),
    unitsSoldClicks1d: String(r.unitsSoldClicks1d ?? '0'),
    unitsSoldClicks7d: String(r.unitsSoldClicks7d ?? '0'),
    unitsSoldClicks14d: String(r.unitsSoldClicks14d ?? '0'),
    unitsSoldClicks30d: String(r.unitsSoldClicks30d ?? '0'),
    acosClicks14d: String(r.acosClicks14d ?? ''),
    roasClicks14d: String(r.roasClicks14d ?? ''),
    country,
    created_at: new Date(),
    updated_at: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(productPlacement).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

async function insertSbSearchTermRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    date: r.date ?? null,
    searchTerm: r.searchTerm ?? null,
    impressions: r.impressions ? Number(r.impressions) : 0,
    clicks: r.clicks ? Number(r.clicks) : 0,
    cost: String(r.cost ?? '0'),
    purchases: r.purchases ? Number(r.purchases) : 0,
    sales: String(r.sales ?? '0'),
    unitsSold: r.unitsSold ? Number(r.unitsSold) : 0,
    purchasesClicks: r.purchasesClicks ? Number(r.purchasesClicks) : 0,
    salesClicks: String(r.salesClicks ?? '0'),
    keywordId: r.keywordId ? Number(r.keywordId) : null,
    keywordText: r.keywordText ?? null,
    keywordType: r.keywordType ?? null,
    keywordBid: String(r.keywordBid ?? '0'),
    adKeywordStatus: r.adKeywordStatus ?? null,
    matchType: r.matchType ?? null,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    campaignStatus: r.campaignStatus ?? null,
    campaignBudgetType: r.campaignBudgetType ?? null,
    campaignBudgetAmount: String(r.campaignBudgetAmount ?? '0'),
    campaignBudgetCurrencyCode: r.campaignBudgetCurrencyCode ?? null,
    adGroupId: r.adGroupId ? Number(r.adGroupId) : null,
    adGroupName: r.adGroupName ?? null,
    country,
    ingestedAt: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(brandSearchTerms).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

async function insertSbPlacementRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    date: r.date ?? null,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    campaignStatus: r.campaignStatus ?? null,
    costType: r.costType ?? null,
    impressions: r.impressions ? Number(r.impressions) : 0,
    clicks: r.clicks ? Number(r.clicks) : 0,
    cost: String(r.cost ?? '0'),
    purchases: r.purchases ? Number(r.purchases) : 0,
    sales: String(r.sales ?? '0'),
    unitsSold: r.unitsSold ? Number(r.unitsSold) : 0,
    viewableImpressions: r.viewableImpressions ? Number(r.viewableImpressions) : 0,
    viewabilityRate: String(r.viewabilityRate ?? '0'),
    newToBrandPurchases: r.newToBrandPurchases ? Number(r.newToBrandPurchases) : 0,
    newToBrandSales: String(r.newToBrandSales ?? '0'),
    newToBrandUnitsSold: r.newToBrandUnitsSold ? Number(r.newToBrandUnitsSold) : 0,
    country,
    insertedAt: new Date(),
    updatedAt: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(brandPlacement).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

async function insertSdMatchedTargetRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    date: r.date ?? null,
    country,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    adGroupId: r.adGroupId ? Number(r.adGroupId) : null,
    adGroupName: r.adGroupName ?? null,
    targetingId: r.targetingId ? Number(r.targetingId) : null,
    targetingText: r.targetingText ?? null,
    targetingExpression: r.targetingExpression ?? null,
    matchedTargetAsin: r.matchedTargetAsin ?? null,
    impressions: r.impressions ? Number(r.impressions) : 0,
    clicks: r.clicks ? Number(r.clicks) : 0,
    cost: String(r.cost ?? '0'),
    sales: String(r.sales ?? '0'),
    salesClicks: String(r.salesClicks ?? '0'),
    purchases: r.purchases ? Number(r.purchases) : 0,
    purchasesClicks: r.purchasesClicks ? Number(r.purchasesClicks) : 0,
    unitsSold: r.unitsSold ? Number(r.unitsSold) : 0,
    newToBrandPurchases: r.newToBrandPurchases ? Number(r.newToBrandPurchases) : 0,
    newToBrandSales: String(r.newToBrandSales ?? '0'),
    detailPageViews: r.detailPageViews ? Number(r.detailPageViews) : 0,
    detailPageViewsClicks: r.detailPageViewsClicks ? Number(r.detailPageViewsClicks) : 0,
    created_at: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(displayMatchedTarget).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

async function insertSdTargetingRows(rows: any[], country: string): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map(r => ({
    date: r.date ?? null,
    country,
    campaignId: r.campaignId ? Number(r.campaignId) : null,
    campaignName: r.campaignName ?? null,
    adGroupId: r.adGroupId ? Number(r.adGroupId) : null,
    adGroupName: r.adGroupName ?? null,
    targetingId: r.targetingId ? Number(r.targetingId) : null,
    targetingText: r.targetingText ?? null,
    targetingExpression: r.targetingExpression ?? null,
    impressions: r.impressions ? Number(r.impressions) : 0,
    clicks: r.clicks ? Number(r.clicks) : 0,
    cost: String(r.cost ?? '0'),
    sales: String(r.sales ?? '0'),
    salesClicks: String(r.salesClicks ?? '0'),
    purchases: r.purchases ? Number(r.purchases) : 0,
    purchasesClicks: r.purchasesClicks ? Number(r.purchasesClicks) : 0,
    unitsSold: r.unitsSold ? Number(r.unitsSold) : 0,
    newToBrandPurchases: r.newToBrandPurchases ? Number(r.newToBrandPurchases) : 0,
    newToBrandSales: String(r.newToBrandSales ?? '0'),
    newToBrandUnitsSold: r.newToBrandUnitsSold ? Number(r.newToBrandUnitsSold) : 0,
    detailPageViews: r.detailPageViews ? Number(r.detailPageViews) : 0,
    viewabilityRate: String(r.viewabilityRate ?? '0'),
    addToCartRate: String(r.addToCartRate ?? '0'),
    created_at: new Date(),
  }));

  let inserted = 0;
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await db.insert(displayTargeting).values(batch as any);
    inserted += batch.length;
  }
  return inserted;
}

// ─── Insert dispatcher ───────────────────────────────────────────────────────

const INSERT_FN: Record<string, (rows: any[], country: string) => Promise<number>> = {
  spSearchTerm: insertSpSearchTermRows,
  spPlacement: insertSpPlacementRows,
  sbSearchTerm: insertSbSearchTermRows,
  sbPlacement: insertSbPlacementRows,
  sdMatchedTarget: insertSdMatchedTargetRows,
  sdTargeting: insertSdTargetingRows,
};

// ─── Public sync function ────────────────────────────────────────────────────

/**
 * Run a full sync: fetch all 6 report types for the given date range
 * and insert the data into Supabase.
 *
 * @param startDate YYYY-MM-DD (defaults to yesterday)
 * @param endDate   YYYY-MM-DD (defaults to yesterday)
 * @param country   Country code override (auto-detected from profile if omitted)
 */
export async function syncAmazonAdsData(
  startDate?: string,
  endDate?: string,
  country?: string,
): Promise<FullSyncResult> {
  const startedAt = new Date().toISOString();
  const client = getAmazonAdsClient();

  if (!client) {
    return {
      success: false,
      startedAt,
      completedAt: new Date().toISOString(),
      results: [{ reportType: 'all', rowsFetched: 0, rowsInserted: 0, error: 'Amazon Ads credentials not configured' }],
      totalRows: 0,
    };
  }

  // Default to yesterday (Amazon data has ~24h delay)
  if (!startDate || !endDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    const defaultDate = `${yyyy}-${mm}-${dd}`;
    startDate = startDate || defaultDate;
    endDate = endDate || defaultDate;
  }

  // Resolve country from region env var if not provided
  const resolvedCountry = country || normalizeCountry(process.env.AMAZON_ADS_COUNTRY);

  const reportTypes: ReportRequest['reportType'][] = [
    'spSearchTerm', 'spPlacement',
    'sbSearchTerm', 'sbPlacement',
    'sdMatchedTarget', 'sdTargeting',
  ];

  const results: SyncResult[] = [];
  let totalRows = 0;

  for (const reportType of reportTypes) {
    try {
      console.log(`[AmazonAdsSync] Fetching ${reportType} (${startDate} → ${endDate})...`);
      const rows = await client.fetchReport({ reportType, startDate, endDate });
      console.log(`[AmazonAdsSync] ${reportType}: ${rows.length} rows fetched`);

      const insertFn = INSERT_FN[reportType];
      const inserted = await insertFn(rows, resolvedCountry);
      console.log(`[AmazonAdsSync] ${reportType}: ${inserted} rows inserted`);

      results.push({ reportType, rowsFetched: rows.length, rowsInserted: inserted });
      totalRows += inserted;
    } catch (err: any) {
      console.error(`[AmazonAdsSync] ${reportType} failed:`, err.message);
      results.push({ reportType, rowsFetched: 0, rowsInserted: 0, error: err.message });
    }
  }

  const allSucceeded = results.every(r => !r.error);

  return {
    success: allSucceeded,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    totalRows,
  };
}
