import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { brandSearchTerms, brandPlacement, productSearchTerms, productPlacement, displayMatchedTarget, displayTargeting, recommendations, bidChangeHistory } from "@shared/schema";
import { sql, eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { calculateACOS, calculateCPC, calculateCVR, calculateROAS, getConfidenceLevel } from "./utils/calculations";
import { generateBidRecommendation, detectNegativeKeywords, generateBulkRecommendations, formatRecommendationsForCSV } from "./utils/recommendations";
import { getExchangeRatesForDate, getExchangeRatesForRange, convertToEur } from "./utils/exchangeRates";
import { normalizePlacementName, getCurrencyForCountry, BID_ADJUSTMENT_PLACEMENT_MAP } from "@shared/currency";
import postgres from "postgres";
import * as XLSX from 'xlsx';
import { getCached, setCache, generateCacheKey } from "./cache";
import { queryAgent, queryAgentStream } from "./agent";
import { createBidChangeHistoryTable } from "./migrations/bidChangeHistory";
import { createAcosTargetsTable, importAcosTargetsFromCSV, getAcosTargetForCampaign } from "./migrations/acosTargets";
import { 
  createWeightConfigTable, 
  createRecommendationHistoryTable, 
  getWeightsForCountry, 
  updateWeightsForCountry,
  saveRecommendation,
  markRecommendationImplemented,
  getRecommendationHistory
} from "./migrations/biddingStrategy";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // KPI aggregation endpoint - filters by campaign type
  app.get("/api/kpis", async (req, res) => {
    // Check cache first
    const cacheKey = generateCacheKey('/api/kpis', req.query as Record<string, any>);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    try {
      const { country, campaignId, adGroupId, campaignType = 'products', from, to, convertToEur: convertToEurParam = 'true' } = req.query;
      const shouldConvertToEur = convertToEurParam === 'true';
      
      let results: Array<{ date: any; currency: any; clicks: number; cost: number; sales: number; orders: number }> = [];

      if (campaignType === 'brands') {
        // Query brand data only (no adGroupId filter - brand tables don't use this)
        const conditions = [];
        if (country) conditions.push(eq(brandSearchTerms.country, country as string));
        if (campaignId) conditions.push(sql`${brandSearchTerms.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        results = await db
          .select({
            date: brandSearchTerms.date,
            currency: brandSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(brandSearchTerms.date, brandSearchTerms.campaignBudgetCurrencyCode);
      } else if (campaignType === 'display') {
        // Query display data (no adGroupId filter - display tables don't have this field)
        const conditions = [];
        if (country) conditions.push(eq(displayMatchedTarget.country, country as string));
        if (campaignId) conditions.push(sql`${displayMatchedTarget.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(displayMatchedTarget.date, from as string));
        if (to) conditions.push(lte(displayMatchedTarget.date, to as string));

        results = await db
          .select({
            date: displayMatchedTarget.date,
            currency: displayMatchedTarget.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
          })
          .from(displayMatchedTarget)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(displayMatchedTarget.date, displayMatchedTarget.campaignBudgetCurrencyCode);
      } else {
        // Default: Query product data only
        const conditions = [];
        if (country) conditions.push(eq(productSearchTerms.country, country as string));
        if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
        if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        results = await db
          .select({
            date: productSearchTerms.date,
            currency: productSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.date, productSearchTerms.campaignBudgetCurrencyCode);
      }

      // Aggregate data (with optional EUR conversion)
      let totalClicks = 0;
      let totalCost = 0;
      let totalSales = 0;
      let totalOrders = 0;
      let resultCurrency = 'EUR';

      if (shouldConvertToEur) {
        // Get date range for exchange rate fetching
        const dates = results.map(row => row.date).filter(Boolean);
        const minDate = dates.length > 0 ? dates.reduce((a, b) => a < b ? a : b) : null;
        const maxDate = dates.length > 0 ? dates.reduce((a, b) => a > b ? a : b) : null;

        // Fetch exchange rates for entire date range with single API call
        let exchangeRatesCache = new Map<string, Record<string, number>>();
        if (minDate && maxDate) {
          exchangeRatesCache = await getExchangeRatesForRange(minDate, maxDate);
        }

        // Convert to EUR and aggregate
        results.forEach(row => {
          if (!row.date) return;
          
          const rates = exchangeRatesCache.get(row.date) || {};
          const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
          const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);

          totalClicks += Number(row.clicks);
          totalCost += costEur;
          totalSales += salesEur;
          totalOrders += Number(row.orders);
        });
        resultCurrency = 'EUR';
      } else {
        // Keep local currency - no conversion
        // GUARD: Ensure single currency when not converting
        const uniqueCurrencies = new Set(results.map(r => r.currency).filter(Boolean));
        if (uniqueCurrencies.size > 1) {
          return res.status(400).json({ 
            error: 'Cannot aggregate multiple currencies without conversion. Use convertToEur=true or filter by country.' 
          });
        }
        
        results.forEach(row => {
          totalClicks += Number(row.clicks);
          totalCost += Number(row.cost);
          totalSales += Number(row.sales);
          totalOrders += Number(row.orders);
        });
        // Safe to use first currency now - we've verified there's only one
        resultCurrency = results[0]?.currency || 'EUR';
      }

      const acos = calculateACOS(totalCost, totalSales);
      const cpc = calculateCPC(totalCost, totalClicks);
      const roas = calculateROAS(totalSales, totalCost);

      const response = {
        adSales: totalSales,
        acos,
        cpc,
        cost: totalCost,
        roas,
        orders: totalOrders,
        clicks: totalClicks,
        currency: resultCurrency,
      };
      
      // Cache the response
      setCache(cacheKey, response);
      
      res.json(response);
    } catch (error) {
      console.error('KPI error:', error);
      res.status(500).json({ error: 'Failed to fetch KPIs' });
    }
  });

  // Countries list endpoint - respects campaignType filter with EUR conversion
  app.get("/api/countries", async (req, res) => {
    // Check cache first
    const cacheKey = generateCacheKey('/api/countries', req.query as Record<string, any>);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    try {
      const { from, to, campaignType = 'products' } = req.query;
      
      let results: Array<{ country: any; date: any; currency: any; clicks: number; cost: number; sales: number; orders: number }> = [];

      if (campaignType === 'brands') {
        // Query only brand data
        const conditions = [];
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        results = await db
          .select({
            country: brandSearchTerms.country,
            date: brandSearchTerms.date,
            currency: brandSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(brandSearchTerms.country, brandSearchTerms.date, brandSearchTerms.campaignBudgetCurrencyCode);
      } else if (campaignType === 'display') {
        // Query only display data
        const conditions = [];
        if (from) conditions.push(gte(displayMatchedTarget.date, from as string));
        if (to) conditions.push(lte(displayMatchedTarget.date, to as string));

        results = await db
          .select({
            country: displayMatchedTarget.country,
            date: displayMatchedTarget.date,
            currency: displayMatchedTarget.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
          })
          .from(displayMatchedTarget)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(displayMatchedTarget.country, displayMatchedTarget.date, displayMatchedTarget.campaignBudgetCurrencyCode);
      } else {
        // Default: Query only product data (Sponsored Products)
        const conditions = [];
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        results = await db
          .select({
            country: productSearchTerms.country,
            date: productSearchTerms.date,
            currency: productSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.country, productSearchTerms.date, productSearchTerms.campaignBudgetCurrencyCode);
      }

      // Get date range for exchange rate fetching
      const allDates = results.map(row => row.date).filter((d): d is string => Boolean(d));
      const minDate = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : null;
      const maxDate = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : null;

      // Fetch exchange rates for entire date range with single API call
      let exchangeRatesCache = new Map<string, Record<string, number>>();
      if (minDate && maxDate) {
        exchangeRatesCache = await getExchangeRatesForRange(minDate, maxDate);
      }

      // Aggregate by country and convert to EUR
      const countryMap = new Map<string, {
        country: string;
        clicks: number;
        costEur: number;
        salesEur: number;
        orders: number;
      }>();

      results.forEach(row => {
        if (!row.country || !row.date) return;
        
        const rates = exchangeRatesCache.get(row.date) || {};
        const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
        const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);

        const existing = countryMap.get(row.country);
        if (existing) {
          existing.clicks += Number(row.clicks);
          existing.costEur += costEur;
          existing.salesEur += salesEur;
          existing.orders += Number(row.orders);
        } else {
          countryMap.set(row.country, {
            country: row.country,
            clicks: Number(row.clicks),
            costEur,
            salesEur,
            orders: Number(row.orders),
          });
        }
      });

      // Format response with EUR values
      const countries = Array.from(countryMap.values())
        .map(row => ({
          country: row.country,
          code: row.country,
          clicks: row.clicks,
          cost: row.costEur,
          sales: row.salesEur,
          orders: row.orders,
          acos: calculateACOS(row.costEur, row.salesEur),
          currency: 'EUR', // All values now in EUR
        }))
        .sort((a, b) => b.sales - a.sales);

      // Cache the response
      setCache(cacheKey, countries);
      
      res.json(countries);
    } catch (error) {
      console.error('Countries error:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // Campaigns by country endpoint - combines brand + product
  app.get("/api/campaigns", async (req, res) => {
    try {
      const { country, from, to, convertToEur: convertToEurParam = 'true' } = req.query;
      const convertToEur = convertToEurParam === 'true';
      
      // Query brand campaigns
      const brandConditions = [];
      if (country) brandConditions.push(eq(brandSearchTerms.country, country as string));
      if (from) brandConditions.push(gte(brandSearchTerms.date, from as string));
      if (to) brandConditions.push(lte(brandSearchTerms.date, to as string));

      const brandResults = await db
        .select({
          campaignId: brandSearchTerms.campaignId,
          campaignName: sql<string>`MAX(${brandSearchTerms.campaignName})`,
          clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
          orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
          currency: sql<string>`MAX(${brandSearchTerms.campaignBudgetCurrencyCode})`,
        })
        .from(brandSearchTerms)
        .where(brandConditions.length > 0 ? and(...brandConditions) : undefined)
        .groupBy(brandSearchTerms.campaignId);

      // Query product campaigns
      const productConditions = [];
      if (country) productConditions.push(eq(productSearchTerms.country, country as string));
      if (from) productConditions.push(gte(productSearchTerms.date, from as string));
      if (to) productConditions.push(lte(productSearchTerms.date, to as string));

      const productResults = await db
        .select({
          campaignId: productSearchTerms.campaignId,
          campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
          currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
        })
        .from(productSearchTerms)
        .where(productConditions.length > 0 ? and(...productConditions) : undefined)
        .groupBy(productSearchTerms.campaignId);

      // Combine by campaign ID
      const campaignMap = new Map();
      
      brandResults.forEach(row => {
        if (row.campaignId) {
          campaignMap.set(String(row.campaignId), {
            id: row.campaignId,
            campaign: row.campaignName,
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            orders: Number(row.orders),
            currency: row.currency,
          });
        }
      });

      productResults.forEach(row => {
        if (row.campaignId) {
          const key = String(row.campaignId);
          const existing = campaignMap.get(key);
          if (existing) {
            existing.clicks += Number(row.clicks);
            existing.cost += Number(row.cost);
            existing.sales += Number(row.sales);
            existing.orders += Number(row.orders);
          } else {
            campaignMap.set(key, {
              id: row.campaignId,
              campaign: row.campaignName,
              clicks: Number(row.clicks),
              cost: Number(row.cost),
              sales: Number(row.sales),
              orders: Number(row.orders),
              currency: row.currency,
            });
          }
        }
      });

      const campaigns = Array.from(campaignMap.values())
        .map(row => ({
          ...row,
          acos: calculateACOS(row.cost, row.sales),
        }))
        .sort((a, b) => b.sales - a.sales);

      // Multi-currency guard: prevent mixing currencies when not converting to EUR
      if (!convertToEur && campaigns.length > 0) {
        const currencies = new Set(campaigns.map(row => row.currency).filter(Boolean));
        if (currencies.size > 1) {
          return res.status(400).json({ 
            error: 'Cannot aggregate campaigns from multiple currencies without EUR conversion',
            currencies: Array.from(currencies),
            hint: 'Add convertToEur=true parameter or filter by a single country'
          });
        }
      }

      res.json(campaigns);
    } catch (error) {
      console.error('Campaigns error:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // Ad groups by campaign endpoint - filters by campaign type
  app.get("/api/ad-groups", async (req, res) => {
    try {
      const { campaignId, campaignType = 'products', from, to } = req.query;
      
      let results: Array<{ adGroupId: any; adGroupName: string; clicks: number; cost: number; sales: number; orders: number; currency: string }> = [];

      if (campaignType === 'brands') {
        // Query brand ad groups only
        const conditions = [];
        if (campaignId) conditions.push(sql`${brandSearchTerms.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        results = await db
          .select({
            adGroupId: brandSearchTerms.adGroupId,
            adGroupName: sql<string>`MAX(${brandSearchTerms.adGroupName})`,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
            currency: sql<string>`MAX(${brandSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(brandSearchTerms.adGroupId);
      } else if (campaignType === 'display') {
        // Display campaigns don't have ad groups in the same structure
        // Return empty array for display campaigns
        results = [];
      } else {
        // Default: Query product ad groups only
        const conditions = [];
        if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        results = await db
          .select({
            adGroupId: productSearchTerms.adGroupId,
            adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
            currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.adGroupId);
      }

      const adGroups = results
        .filter(row => row.adGroupId)
        .map(row => ({
          id: row.adGroupId,
          adGroup: row.adGroupName,
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.orders),
          currency: row.currency,
          acos: calculateACOS(Number(row.cost), Number(row.sales)),
        }))
        .sort((a, b) => b.sales - a.sales);

      res.json(adGroups);
    } catch (error) {
      console.error('Ad groups error:', error);
      res.status(500).json({ error: 'Failed to fetch ad groups' });
    }
  });

  // Targeting endpoint - aggregates by targeting (keyword/ASIN you bid on) instead of search term
  // This aligns with Amazon's Advertising Console where you set bids at the targeting level
  app.get("/api/search-terms", async (req, res) => {
    try {
      const { adGroupId, campaignId, campaignType = 'products', from, to, convertToEur: convertToEurParam = 'true' } = req.query;
      const convertToEur = convertToEurParam === 'true';
      
      // Fetch campaign-specific ACOS target from database if campaignId is provided
      let targetAcos = 20; // Default fallback for backwards compatibility
      if (campaignId) {
        const acosTarget = await getAcosTargetForCampaign(campaignId as string);
        if (acosTarget === null) {
          return res.status(400).json({ 
            error: 'ACOS target not configured',
            message: `No ACOS target found for campaign ${campaignId}. Please add it to the ACOS_Target_Campaign table.`,
            campaignId
          });
        }
        targetAcos = acosTarget * 100; // Convert from decimal (0.35) to percentage (35)
      }
      
      let results: Array<{
        targeting: string | null;
        matchType: string | null;
        keywordBid: number;
        clicks: number;
        cost: number;
        sales: number;
        orders: number;
        currency: string | null;
      }> = [];

      if (campaignType === 'brands') {
        // Query brand data - aggregate by keywordText (the targeting)
        const conditions = [];
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        results = await db
          .select({
            targeting: brandSearchTerms.keywordText,
            matchType: brandSearchTerms.matchType,
            keywordBid: sql<number>`MAX(${brandSearchTerms.keywordBid})`,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
            currency: sql<string>`MAX(${brandSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(brandSearchTerms.keywordText, brandSearchTerms.matchType);
      } else if (campaignType === 'display') {
        // Query display data - aggregate by targetingText
        const conditions = [];
        if (from) conditions.push(gte(displayMatchedTarget.date, from as string));
        if (to) conditions.push(lte(displayMatchedTarget.date, to as string));

        const displayResults = await db
          .select({
            targeting: displayMatchedTarget.targetingText,
            clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
            currency: sql<string>`MAX(${displayMatchedTarget.campaignBudgetCurrencyCode})`,
          })
          .from(displayMatchedTarget)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(displayMatchedTarget.targetingText);

        // Map display results to match the structure
        results = displayResults.map(row => ({
          targeting: row.targeting,
          matchType: 'Display',
          keywordBid: 0, // Display doesn't have keyword bids like search
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.orders),
          currency: row.currency,
        }));
      } else {
        // Default: Query product data - aggregate by targeting (the keyword you bid on)
        const conditions = [];
        if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        results = await db
          .select({
            targeting: productSearchTerms.targeting,
            matchType: productSearchTerms.matchType,
            keywordBid: sql<number>`MAX(${productSearchTerms.keywordBid})`,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
            currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.targeting, productSearchTerms.matchType);
      }

      const targetingData = results
        .filter(row => row.targeting)
        .map(row => {
          const acos = calculateACOS(row.cost, row.sales);
          const cpc = calculateCPC(row.cost, row.clicks);
          const cvr = Number(row.clicks) > 0 ? (Number(row.orders) / Number(row.clicks)) * 100 : 0;
          // Use campaign-specific ACOS target (fetched at endpoint level)
          const lowerBound = targetAcos * 0.8;
          const upperBound = targetAcos * 1.1;
          const maxChangePercent = 25; // Cap at ±25% per adjustment
          
          const baseBid = row.keywordBid || cpc || 1.0;
          let recommendedBid: number | null = null;
          let bidChange: number | null = null;
          let rationale: string | null = null;
          let action: string | null = null;
          const confidenceData = getConfidenceLevel(row.clicks);
          
          // Apply PPC AI logic only for targetings with 30+ clicks
          if (row.clicks >= 30) {
            if (row.sales === 0) {
              // No sales - reduce bid incrementally (capped at -25%)
              const decreasePercent = Math.min(maxChangePercent, 15 + Math.floor(row.clicks / 50) * 5);
              recommendedBid = baseBid * (1 - decreasePercent / 100);
              action = 'decrease';
              rationale = `No sales after ${row.clicks} clicks (CVR: 0%). Reducing bid by ${decreasePercent}%.`;
            } else if (acos < lowerBound) {
              // ACOS below target range - increase bid (formula-based, capped at +25%)
              const formulaBid = baseBid * (targetAcos / acos);
              const maxIncrease = baseBid * (1 + maxChangePercent / 100);
              recommendedBid = Math.min(formulaBid, maxIncrease);
              action = 'increase';
              rationale = `ACOS ${acos.toFixed(1)}% is below target range (${lowerBound.toFixed(0)}%-${upperBound.toFixed(0)}%). CVR: ${cvr.toFixed(2)}%.`;
            } else if (acos > upperBound) {
              // ACOS above target range - decrease bid (formula-based, capped at -25%)
              const formulaBid = baseBid * (targetAcos / acos);
              const maxDecrease = baseBid * (1 - maxChangePercent / 100);
              recommendedBid = Math.max(formulaBid, maxDecrease);
              action = 'decrease';
              rationale = `ACOS ${acos.toFixed(1)}% exceeds target range (${lowerBound.toFixed(0)}%-${upperBound.toFixed(0)}%). CVR: ${cvr.toFixed(2)}%.`;
            } else {
              // ACOS within target range (16%-22%) - no change needed
              recommendedBid = null;
              action = 'maintain';
              rationale = `ACOS ${acos.toFixed(1)}% is within target range. No adjustment needed.`;
            }
            
            if (recommendedBid !== null) {
              // Apply safeguards: minimum 0.02, max 200% of base bid
              const minBid = 0.02;
              const maxBid = baseBid * 2;
              recommendedBid = Math.max(minBid, Math.min(maxBid, recommendedBid));
              recommendedBid = Math.round(recommendedBid * 100) / 100;
              bidChange = baseBid > 0 ? ((recommendedBid - baseBid) / baseBid) * 100 : 0;
            }
          }

          return {
            targeting: row.targeting,
            matchType: row.matchType,
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            orders: Number(row.orders),
            acos,
            cpc,
            cvr,
            currentBid: Number(row.keywordBid || 0),
            recommendedBid: recommendedBid,
            bidChange: bidChange,
            action: action,
            rationale: rationale,
            confidence: confidenceData.label,
            confidenceLevel: confidenceData.level,
            currency: row.currency,
          };
        })
        .sort((a, b) => b.clicks - a.clicks);

      // Multi-currency guard: prevent mixing currencies when not converting to EUR
      if (!convertToEur && targetingData.length > 0) {
        const currencies = new Set(targetingData.map(row => row.currency).filter(Boolean));
        if (currencies.size > 1) {
          return res.status(400).json({ 
            error: 'Cannot aggregate data from multiple currencies without EUR conversion',
            currencies: Array.from(currencies),
            hint: 'Add convertToEur=true parameter or filter by a single country'
          });
        }
      }

      res.json(targetingData);
    } catch (error) {
      console.error('Targeting error:', error);
      res.status(500).json({ error: 'Failed to fetch targeting data' });
    }
  });

  // Placements by campaign endpoint - filters by campaign type
  app.get("/api/placements", async (req, res) => {
    try {
      const { campaignId, adGroupId, country, campaignType = 'products', from, to } = req.query;
      
      let results: Array<{ placement: string | null; clicks: number; cost: number; sales: number; purchases: number }> = [];

      if (campaignType === 'brands') {
        // Query brand placements only (no adGroupId in brand tables)
        const conditions = [];
        if (campaignId) conditions.push(sql`${brandPlacement.campaignId}::text = ${campaignId}`);
        if (country) conditions.push(eq(brandPlacement.country, country as string));
        if (from) conditions.push(gte(brandPlacement.date, from as string));
        if (to) conditions.push(lte(brandPlacement.date, to as string));

        results = await db
          .select({
            placement: sql<string>`'Brand'`, // Brand doesn't have placement types, label as 'Brand'
            clicks: sql<number>`COALESCE(SUM(${brandPlacement.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandPlacement.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandPlacement.sales}), 0)`,
            purchases: sql<number>`COALESCE(SUM(${brandPlacement.purchases}), 0)`,
          })
          .from(brandPlacement)
          .where(conditions.length > 0 ? and(...conditions) : undefined);
      } else if (campaignType === 'display') {
        // Query display targeting (equivalent to placements for display, no adGroupId filter)
        const conditions = [];
        if (campaignId) conditions.push(sql`${displayTargeting.campaignId}::text = ${campaignId}`);
        if (country) conditions.push(eq(displayTargeting.country, country as string));
        if (from) conditions.push(gte(displayTargeting.date, from as string));
        if (to) conditions.push(lte(displayTargeting.date, to as string));

        results = await db
          .select({
            placement: displayTargeting.targetingText,
            clicks: sql<number>`COALESCE(SUM(${displayTargeting.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayTargeting.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayTargeting.sales}), 0)`,
            purchases: sql<number>`COALESCE(SUM(${displayTargeting.purchases}), 0)`,
          })
          .from(displayTargeting)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(displayTargeting.targetingText);
      } else {
        // Default: Query product placements only
        const conditions = [];
        if (campaignId) conditions.push(sql`${productPlacement.campaignId}::text = ${campaignId}`);
        if (country) conditions.push(eq(productPlacement.country, country as string));
        if (from) conditions.push(gte(productPlacement.date, from as string));
        if (to) conditions.push(lte(productPlacement.date, to as string));

        results = await db
          .select({
            placement: productPlacement.placementClassification,
            clicks: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.clicks}, '')::numeric), 0)`,
            cost: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.cost}, '')::numeric), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.sales30d}, '')::numeric), 0)`,
            purchases: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.purchases30d}, '')::numeric), 0)`,
          })
          .from(productPlacement)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productPlacement.placementClassification);
      }

      const placements = results
        .filter(row => row.placement)
        .map(row => ({
          placement: normalizePlacementName(row.placement),
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.purchases),
          acos: calculateACOS(Number(row.cost), Number(row.sales)),
        }))
        .sort((a, b) => b.sales - a.sales);

      res.json(placements);
    } catch (error) {
      console.error('Placements error:', error);
      res.status(500).json({ error: 'Failed to fetch placements' });
    }
  });

  // Campaign-level placements endpoint - aggregates across all ad groups (Sponsored Products only)
  app.get("/api/campaign-placements", async (req, res) => {
    try {
      const { campaignId, from, to } = req.query;
      
      if (!campaignId) {
        return res.status(400).json({ error: 'Campaign ID is required' });
      }
      
      // Fetch campaign-specific ACOS target from database
      const acosTarget = await getAcosTargetForCampaign(campaignId as string);
      if (acosTarget === null) {
        return res.status(400).json({ 
          error: 'ACOS target not configured',
          message: `No ACOS target found for campaign ${campaignId}. Please add it to the ACOS_Target_Campaign table.`,
          campaignId
        });
      }
      
      const targetAcos = acosTarget * 100; // Convert from decimal (0.35) to percentage (35)
      
      // Query ALL placement data for the campaign in one go (not aggregated yet)
      const conditions: any[] = [];
      if (campaignId) conditions.push(sql`${productPlacement.campaignId}::text = ${campaignId}`);
      if (from) conditions.push(gte(productPlacement.date, from as string));
      if (to) conditions.push(lte(productPlacement.date, to as string));

      const allResults = await db
        .select({
          placement: productPlacement.placementClassification,
          biddingStrategy: productPlacement.campaignBiddingStrategy,
          date: productPlacement.date,
          country: productPlacement.country,
          impressions: sql<string>`NULLIF(${productPlacement.impressions}, '')`,
          clicks: sql<string>`NULLIF(${productPlacement.clicks}, '')`,
          cost: sql<string>`NULLIF(${productPlacement.cost}, '')`,
          sales: sql<string>`NULLIF(${productPlacement.sales30d}, '')`,
          purchases: sql<string>`NULLIF(${productPlacement.purchases30d}, '')`,
        })
        .from(productPlacement)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // Fetch latest bid adjustments from "Bid_Adjustments" table for this campaign
      let bidAdjustmentsMap = new Map<string, number>();
      if (campaignId) {
        const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
        const sqlClient = postgres(connectionUrl);
        try {
          const bidAdjustments = await sqlClient`
            SELECT DISTINCT ON (placement)
              placement, percent
            FROM "Bid_Adjustments"
            WHERE "CampaignId"::text = ${campaignId as string}
            ORDER BY placement, created_at DESC
          `;
          
          // Map bid adjustment table placement names to normalized names
          for (const row of bidAdjustments) {
            const placement = row.placement as string;
            const percent = Number(row.percent ?? 0);
            const normalizedPlacement = BID_ADJUSTMENT_PLACEMENT_MAP[placement];
            if (normalizedPlacement) {
              bidAdjustmentsMap.set(normalizedPlacement, percent);
            }
          }
        } catch (bidError) {
          console.warn('Could not fetch bid adjustments:', bidError);
        } finally {
          await sqlClient.end();
        }
      }

      // Get date range for exchange rates (fetch all at once with single API call)
      const allDates = allResults.map(r => r.date).filter(Boolean);
      const minDate = allDates.length > 0 ? allDates.reduce((a, b) => a! < b! ? a : b) : null;
      const maxDate = allDates.length > 0 ? allDates.reduce((a, b) => a! > b! ? a : b) : null;
      
      let exchangeRatesMap = new Map<string, Record<string, number>>();
      if (minDate && maxDate) {
        exchangeRatesMap = await getExchangeRatesForRange(minDate, maxDate);
      }

      // Group and aggregate data in memory
      const placementGroups = new Map<string, {
        placement: string;
        biddingStrategy: string;
        totalImpressions: number;
        totalClicks: number;
        totalCostEur: number;
        totalSalesEur: number;
        totalOrders: number;
      }>();

      // Process all results in memory
      allResults.forEach(row => {
        const key = `${row.placement || 'UNKNOWN'}_${row.biddingStrategy || 'Not set'}`;
        
        if (!placementGroups.has(key)) {
          placementGroups.set(key, {
            placement: row.placement || 'UNKNOWN',
            biddingStrategy: row.biddingStrategy || 'Not set',
            totalImpressions: 0,
            totalClicks: 0,
            totalCostEur: 0,
            totalSalesEur: 0,
            totalOrders: 0,
          });
        }

        const group = placementGroups.get(key)!;
        const rates = exchangeRatesMap.get(row.date || '') || {};

        // Convert to EUR and aggregate
        const impressions = Number(row.impressions || 0);
        const clicks = Number(row.clicks || 0);
        const cost = Number(row.cost || 0);
        const sales = Number(row.sales || 0);
        const orders = Number(row.purchases || 0);

        // Map country code to currency (productPlacement table doesn't have currency column)
        const currency = getCurrencyForCountry(row.country || '');
        const costEur = convertToEur(cost, currency, rates);
        const salesEur = convertToEur(sales, currency, rates);

        group.totalImpressions += impressions;
        group.totalClicks += clicks;
        group.totalCostEur += costEur;
        group.totalSalesEur += salesEur;
        group.totalOrders += orders;
      });

      // Calculate metrics and recommendations
      const placements = Array.from(placementGroups.values()).map(group => {
        const acos = calculateACOS(group.totalCostEur, group.totalSalesEur);
        const cpc = group.totalClicks > 0 ? group.totalCostEur / group.totalClicks : 0;
        const ctr = group.totalImpressions > 0 ? (group.totalClicks / group.totalImpressions) * 100 : 0;
        const cvr = group.totalClicks > 0 ? (group.totalOrders / group.totalClicks) * 100 : 0;
        
        const normalizedPlacement = normalizePlacementName(group.placement);
        const currentBidAdjustment = bidAdjustmentsMap.get(normalizedPlacement) ?? 0;
        
        // Calculate recommended change in bid adjustment based on ACOS
        let recommendedChange = 0;
        
        if (group.totalClicks >= 30 && group.totalSalesEur > 0) {
          if (acos <= targetAcos * 0.8) {
            // ACOS well below target (≤16%), increase bid adjustment
            if (group.totalClicks >= 1000) {
              recommendedChange = 20; // +20 percentage points
            } else if (group.totalClicks >= 300) {
              recommendedChange = 15; // +15 percentage points
            } else {
              recommendedChange = 10; // +10 percentage points
            }
          } else if (acos > targetAcos) {
            // ACOS above target, decrease bid adjustment using formula
            const targetChange = (targetAcos / acos - 1) * 100;
            recommendedChange = Math.max(-50, Math.min(0, targetChange)); // Cap change at -50 points
          } else {
            // ACOS near target, small adjustment
            recommendedChange = (targetAcos / acos - 1) * 100;
            recommendedChange = Math.max(-10, Math.min(10, recommendedChange));
          }
        } else if (group.totalClicks >= 30 && group.totalSalesEur === 0) {
          // No sales, recommend decreasing bid
          recommendedChange = -25; // -25 percentage points
        }
        
        // Calculate target bid adjustment: current + change, capped between 0% and 900%
        let targetBidAdjustment: number | null = null;
        if (group.totalClicks >= 30) {
          const rawTarget = currentBidAdjustment + recommendedChange;
          targetBidAdjustment = Math.round(Math.max(0, Math.min(900, rawTarget)));
        }

        const bidAdjustment = bidAdjustmentsMap.get(normalizedPlacement) ?? null;
        
        return {
          placement: normalizedPlacement,
          biddingStrategy: group.biddingStrategy,
          bidAdjustment,
          impressions: group.totalImpressions,
          clicks: group.totalClicks,
          ctr,
          spend: group.totalCostEur,
          cpc,
          orders: group.totalOrders,
          sales: group.totalSalesEur,
          acos,
          cvr,
          targetBidAdjustment,
        };
      });

      // Sort by placement priority: TOS > ROS > PP > UNKNOWN
      const placementOrder = { 'Top of search (first page)': 1, 'Rest of search': 2, 'Product pages': 3, 'UNKNOWN': 4 };
      placements.sort((a, b) => {
        const orderA = placementOrder[a.placement as keyof typeof placementOrder] || 999;
        const orderB = placementOrder[b.placement as keyof typeof placementOrder] || 999;
        return orderA - orderB;
      });

      // Cross-check: Does this campaign also have keyword bid recommendations?
      let hasKeywordRecs = false;
      let keywordRecCount = 0;
      
      // Get campaign's country for filtering
      const campaignCountry = allResults.length > 0 ? allResults[0].country : null;
      
      if (campaignId && campaignCountry) {
        const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
        const sqlClient = postgres(connectionUrl);
        try {
          // Get ACOS target for this campaign
          const acosTargetResult = await sqlClient`
            SELECT acos_target FROM "ACOS_Target_Campaign" 
            WHERE campaign_id = ${campaignId as string}
            LIMIT 1
          `;
          
          if (acosTargetResult.length > 0) {
            const acosTarget = Number(acosTargetResult[0].acos_target);
            const acosWindow = 0.03; // ±3%
            
            // Check if there are keywords with ACOS outside the window
            const keywordCheckResult = await sqlClient`
              SELECT COUNT(*) as count
              FROM (
                SELECT 
                  keyword,
                  SUM(COALESCE(clicks, 0)) as total_clicks,
                  SUM(COALESCE(cost, 0)) as total_cost,
                  SUM(COALESCE(CAST(NULLIF("sales30d", '') AS NUMERIC), 0)) as total_sales
                FROM "s_products_search_terms"
                WHERE "campaignId"::text = ${campaignId as string}
                  AND country = ${campaignCountry}
                GROUP BY keyword
                HAVING SUM(COALESCE(clicks, 0)) >= 30
              ) as keywords
              WHERE 
                (total_sales > 0 AND (total_cost / total_sales) < ${acosTarget - acosWindow})
                OR (total_sales > 0 AND (total_cost / total_sales) > ${acosTarget + acosWindow})
                OR (total_sales = 0 AND total_clicks >= 30)
            `;
            
            keywordRecCount = Number(keywordCheckResult[0]?.count || 0);
            hasKeywordRecs = keywordRecCount > 0;
          }
        } catch (kwError) {
          console.warn('Could not check keyword recs:', kwError);
        } finally {
          await sqlClient.end();
        }
      }

      // Check if any placement has a recommendation
      const hasPlacementRecs = placements.some(p => 
        p.targetBidAdjustment !== null && p.targetBidAdjustment !== p.bidAdjustment
      );

      res.json({
        placements,
        hasKeywordRecs,
        keywordRecCount,
        hasPlacementRecs,
        campaignId,
      });
    } catch (error) {
      console.error('Campaign placements error:', error);
      res.status(500).json({ error: 'Failed to fetch campaign placements' });
    }
  });

  // Chart data endpoint with aggregation - respects campaignType filter
  app.get("/api/chart-data", async (req, res) => {
    // Check cache first
    const cacheKey = generateCacheKey('/api/chart-data', req.query as Record<string, any>);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    try {
      const { country, campaignId, from, to, groupBy = 'daily', convertToEur: convertToEurParam = 'true', campaignType = 'products' } = req.query;
      const convertToEur = convertToEurParam === 'true';
      
      let results: Array<{ date: string; cost: number; sales: number; currency: string | null; country: string | null }> = [];

      if (campaignType === 'brands') {
        // Query only brand data
        const conditions = [];
        if (country) conditions.push(eq(brandSearchTerms.country, country as string));
        if (campaignId) conditions.push(sql`${brandSearchTerms.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        let dateGroup;
        if (groupBy === 'weekly') {
          dateGroup = sql`DATE_TRUNC('week', ${brandSearchTerms.date})`;
        } else if (groupBy === 'monthly') {
          dateGroup = sql`DATE_TRUNC('month', ${brandSearchTerms.date})`;
        } else {
          dateGroup = brandSearchTerms.date;
        }

        results = await db
          .select({
            date: sql<string>`${dateGroup}::text`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            currency: sql<string>`MAX(${brandSearchTerms.campaignBudgetCurrencyCode})`,
            country: sql<string>`MAX(${brandSearchTerms.country})`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(sql`${dateGroup}`, brandSearchTerms.campaignBudgetCurrencyCode)
          .orderBy(asc(sql`${dateGroup}`));
      } else if (campaignType === 'display') {
        // Query only display data
        const conditions = [];
        if (country) conditions.push(eq(displayMatchedTarget.country, country as string));
        if (campaignId) conditions.push(sql`${displayMatchedTarget.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(displayMatchedTarget.date, from as string));
        if (to) conditions.push(lte(displayMatchedTarget.date, to as string));

        let dateGroup;
        if (groupBy === 'weekly') {
          dateGroup = sql`DATE_TRUNC('week', ${displayMatchedTarget.date}::date)`;
        } else if (groupBy === 'monthly') {
          dateGroup = sql`DATE_TRUNC('month', ${displayMatchedTarget.date}::date)`;
        } else {
          dateGroup = sql`${displayMatchedTarget.date}::date`;
        }

        results = await db
          .select({
            date: sql<string>`${dateGroup}::text`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            currency: sql<string>`MAX(${displayMatchedTarget.campaignBudgetCurrencyCode})`,
            country: sql<string>`MAX(${displayMatchedTarget.country})`,
          })
          .from(displayMatchedTarget)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(sql`${dateGroup}`, displayMatchedTarget.campaignBudgetCurrencyCode)
          .orderBy(asc(sql`${dateGroup}`));
      } else {
        // Default: Query only product data (Sponsored Products)
        const conditions = [];
        if (country) conditions.push(eq(productSearchTerms.country, country as string));
        if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        let dateGroup;
        if (groupBy === 'weekly') {
          dateGroup = sql`DATE_TRUNC('week', ${productSearchTerms.date}::date)`;
        } else if (groupBy === 'monthly') {
          dateGroup = sql`DATE_TRUNC('month', ${productSearchTerms.date}::date)`;
        } else {
          dateGroup = sql`${productSearchTerms.date}::date`;
        }

        results = await db
          .select({
            date: sql<string>`${dateGroup}::text`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
            country: sql<string>`MAX(${productSearchTerms.country})`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(sql`${dateGroup}`, productSearchTerms.campaignBudgetCurrencyCode)
          .orderBy(asc(sql`${dateGroup}`));
      }

      // Work with filtered results
      const combinedResults = results;
      
      // Multi-currency guard: prevent mixing currencies when not converting to EUR
      if (!convertToEur && combinedResults.length > 0) {
        const currencies = new Set(combinedResults.map(row => row.currency).filter(Boolean));
        if (currencies.size > 1) {
          return res.status(400).json({ 
            error: 'Cannot aggregate chart data from multiple currencies without EUR conversion',
            currencies: Array.from(currencies),
            hint: 'Add convertToEur=true parameter or filter by a single country'
          });
        }
      }

      // Convert to EUR if requested
      if (convertToEur && combinedResults.length > 0 && from && to) {
        const ratesMap = await getExchangeRatesForRange(from as string, to as string);
        
        // Convert each row to EUR
        combinedResults.forEach(row => {
          const date = row.date.split('T')[0];
          const rates = ratesMap.get(date);
          if (rates && row.currency) {
            const toEurRate = rates[row.currency as keyof typeof rates];
            if (toEurRate) {
              row.cost = row.cost * toEurRate;
              row.sales = row.sales * toEurRate;
              row.currency = 'EUR';
            }
          }
        });
      }

      // Aggregate by date
      const dateMap = new Map<string, { date: string; cost: number; sales: number; currency: string | null }>();
      
      combinedResults.forEach(row => {
        const date = row.date.split('T')[0];
        const existing = dateMap.get(date);
        if (existing) {
          existing.cost += Number(row.cost);
          existing.sales += Number(row.sales);
        } else {
          dateMap.set(date, {
            date,
            cost: Number(row.cost),
            sales: Number(row.sales),
            currency: row.currency,
          });
        }
      });

      const chartData = Array.from(dateMap.values())
        .map(row => ({
          date: row.date,
          acos: calculateACOS(row.cost, row.sales),
          sales: row.sales,
          currency: row.currency,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Cache the response
      setCache(cacheKey, chartData);
      
      res.json(chartData);
    } catch (error) {
      console.error('Chart data error:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
    }
  });

  // Combined dashboard endpoint - fetches KPIs, countries, and chart data in parallel
  app.get("/api/dashboard", async (req, res) => {
    const cacheKey = generateCacheKey('/api/dashboard', req.query as Record<string, any>);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    try {
      const { from, to, campaignType = 'products', country } = req.query;

      // Helper function to get table based on campaign type
      const getTable = () => {
        if (campaignType === 'brands') return brandSearchTerms;
        if (campaignType === 'display') return displayMatchedTarget;
        return productSearchTerms;
      };

      const table = getTable();

      // Build base conditions
      const baseConditions: any[] = [];
      if (from) baseConditions.push(gte(table.date, from as string));
      if (to) baseConditions.push(lte(table.date, to as string));
      if (country && country !== 'all') baseConditions.push(eq(table.country, country as string));

      // Fetch raw data once with all needed fields
      let rawData: Array<{ 
        date: string | null; 
        country: string | null; 
        currency: string | null; 
        clicks: number; 
        cost: number; 
        sales: number; 
        orders: number;
      }>;

      if (campaignType === 'brands') {
        rawData = await db
          .select({
            date: brandSearchTerms.date,
            country: brandSearchTerms.country,
            currency: brandSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
          })
          .from(brandSearchTerms)
          .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
          .groupBy(brandSearchTerms.date, brandSearchTerms.country, brandSearchTerms.campaignBudgetCurrencyCode);
      } else if (campaignType === 'display') {
        rawData = await db
          .select({
            date: displayMatchedTarget.date,
            country: displayMatchedTarget.country,
            currency: displayMatchedTarget.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
          })
          .from(displayMatchedTarget)
          .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
          .groupBy(displayMatchedTarget.date, displayMatchedTarget.country, displayMatchedTarget.campaignBudgetCurrencyCode);
      } else {
        rawData = await db
          .select({
            date: productSearchTerms.date,
            country: productSearchTerms.country,
            currency: productSearchTerms.campaignBudgetCurrencyCode,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
          })
          .from(productSearchTerms)
          .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
          .groupBy(productSearchTerms.date, productSearchTerms.country, productSearchTerms.campaignBudgetCurrencyCode);
      }

      // Fetch exchange rates once for the entire date range
      const allDates = rawData.map(row => row.date).filter((d): d is string => Boolean(d));
      const minDate = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : null;
      const maxDate = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : null;
      
      let exchangeRatesCache = new Map<string, Record<string, number>>();
      if (minDate && maxDate) {
        exchangeRatesCache = await getExchangeRatesForRange(minDate, maxDate);
      }

      // Process data for KPIs (aggregate all)
      let totalClicks = 0, totalCost = 0, totalSales = 0, totalOrders = 0;
      rawData.forEach(row => {
        if (!row.date) return;
        const rates = exchangeRatesCache.get(row.date) || {};
        totalClicks += Number(row.clicks);
        totalCost += convertToEur(Number(row.cost), row.currency || 'EUR', rates);
        totalSales += convertToEur(Number(row.sales), row.currency || 'EUR', rates);
        totalOrders += Number(row.orders);
      });

      const kpis = {
        adSales: totalSales,
        acos: calculateACOS(totalCost, totalSales),
        cpc: calculateCPC(totalCost, totalClicks),
        cost: totalCost,
        roas: calculateROAS(totalSales, totalCost),
        orders: totalOrders,
        clicks: totalClicks,
        currency: 'EUR',
      };

      // Process data for countries (aggregate by country)
      const countryMap = new Map<string, { country: string; clicks: number; cost: number; sales: number; orders: number }>();
      rawData.forEach(row => {
        if (!row.country || !row.date) return;
        const rates = exchangeRatesCache.get(row.date) || {};
        const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
        const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);
        
        const existing = countryMap.get(row.country);
        if (existing) {
          existing.clicks += Number(row.clicks);
          existing.cost += costEur;
          existing.sales += salesEur;
          existing.orders += Number(row.orders);
        } else {
          countryMap.set(row.country, {
            country: row.country,
            clicks: Number(row.clicks),
            cost: costEur,
            sales: salesEur,
            orders: Number(row.orders),
          });
        }
      });

      const countries = Array.from(countryMap.values())
        .map(row => ({
          country: row.country,
          code: row.country,
          clicks: row.clicks,
          cost: row.cost,
          sales: row.sales,
          orders: row.orders,
          acos: calculateACOS(row.cost, row.sales),
          currency: 'EUR',
        }))
        .sort((a, b) => b.sales - a.sales);

      // Process data for chart (aggregate by week)
      const weekMap = new Map<string, { cost: number; sales: number }>();
      rawData.forEach(row => {
        if (!row.date) return;
        const date = new Date(row.date);
        const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
        const weekKey = weekStart.toISOString().split('T')[0];
        
        const rates = exchangeRatesCache.get(row.date) || {};
        const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
        const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);
        
        const existing = weekMap.get(weekKey);
        if (existing) {
          existing.cost += costEur;
          existing.sales += salesEur;
        } else {
          weekMap.set(weekKey, { cost: costEur, sales: salesEur });
        }
      });

      const chartData = Array.from(weekMap.entries())
        .map(([date, data]) => ({
          date,
          acos: calculateACOS(data.cost, data.sales),
          sales: data.sales,
          currency: 'EUR',
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const response = { kpis, countries, chartData };
      setCache(cacheKey, response);
      res.json(response);
    } catch (error: any) {
      console.error('Dashboard error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch dashboard data',
        details: error.message || 'Unknown error'
      });
    }
  });

  // Negative keywords endpoint
  app.get("/api/negative-keywords", async (req, res) => {
    try {
      const { adGroupId, campaignId } = req.query;
      
      // For now, detect from product search terms only (brand has different structure)
      const conditions = [];
      if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
      if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);

      const results = await db
        .select({
          targeting: productSearchTerms.targeting,
          campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
          adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          impressions: sql<number>`0`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(productSearchTerms.targeting);

      const negatives = detectNegativeKeywords(
        results.map(row => ({
          targeting: row.targeting || '',
          clicks: Number(row.clicks),
          impressions: Number(row.impressions),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.orders),
          currentBid: null,
          cpc: Number(row.clicks) > 0 ? Number(row.cost) / Number(row.clicks) : 0,
        }))
      );

      res.json(negatives);
    } catch (error) {
      console.error('Negative keywords error:', error);
      res.status(500).json({ error: 'Failed to fetch negative keywords' });
    }
  });

  // Export negative keywords as Excel
  app.get("/api/exports/negatives.xlsx", async (req, res) => {
    try {
      const { adGroupId, campaignId } = req.query;
      
      const conditions = [];
      if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
      if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);

      const results = await db
        .select({
          targeting: productSearchTerms.targeting,
          campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
          adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          impressions: sql<number>`0`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(productSearchTerms.targeting);

      const negatives = detectNegativeKeywords(
        results.map(row => ({
          targeting: row.targeting || '',
          clicks: Number(row.clicks),
          impressions: Number(row.impressions),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.orders),
          currentBid: null,
          cpc: Number(row.clicks) > 0 ? Number(row.cost) / Number(row.clicks) : 0,
        }))
      );

      const worksheet = XLSX.utils.json_to_sheet(negatives);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Negative Keywords');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=negative-keywords.xlsx');
      res.send(buffer);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Failed to export negatives' });
    }
  });

  // Export VID campaigns as CSV (campaigns with "VID" in the name)
  app.get("/api/exports/vid-campaigns.csv", async (req, res) => {
    try {
      const results: Array<{
        source_table: string;
        campaign_id: string;
        campaign_name: string;
        country: string;
        campaign_status: string;
      }> = [];

      // Query Brand Search Terms
      const brandSearchTermsData = await db.execute(sql`
        SELECT DISTINCT 
          'brand_search_terms' as source_table,
          campaign_id::text as campaign_id,
          campaign_name,
          country,
          COALESCE(campaign_status, '') as campaign_status
        FROM s_brand_search_terms
        WHERE campaign_name ILIKE '%VID%'
      `);
      for (const row of brandSearchTermsData as any[]) {
        results.push(row);
      }

      // Query Brand Placement
      const brandPlacementData = await db.execute(sql`
        SELECT DISTINCT 
          'brand_placement' as source_table,
          "campaignId"::text as campaign_id,
          "campaignName" as campaign_name,
          '' as country,
          COALESCE("campaignStatus", '') as campaign_status
        FROM "s_brand_placment"
        WHERE "campaignName" ILIKE '%VID%'
      `);
      for (const row of brandPlacementData as any[]) {
        results.push(row);
      }

      // Query Product Search Terms
      const productSearchTermsData = await db.execute(sql`
        SELECT DISTINCT 
          'product_search_terms' as source_table,
          "campaignId"::text as campaign_id,
          "campaignName" as campaign_name,
          COALESCE(country, '') as country,
          COALESCE("campaignStatus", '') as campaign_status
        FROM s_products_search_terms
        WHERE "campaignName" ILIKE '%VID%'
      `);
      for (const row of productSearchTermsData as any[]) {
        results.push(row);
      }

      // Query Product Placement
      const productPlacementData = await db.execute(sql`
        SELECT DISTINCT 
          'product_placement' as source_table,
          "campaignId"::text as campaign_id,
          "campaignName" as campaign_name,
          COALESCE(country, '') as country,
          '' as campaign_status
        FROM s_products_placement
        WHERE "campaignName" ILIKE '%VID%'
      `);
      for (const row of productPlacementData as any[]) {
        results.push(row);
      }

      // Query Display Matched Target
      const displayMatchedTargetData = await db.execute(sql`
        SELECT DISTINCT 
          'display_matched_target' as source_table,
          "campaignId"::text as campaign_id,
          "campaignName" as campaign_name,
          COALESCE(country, '') as country,
          '' as campaign_status
        FROM s_display_matched_target
        WHERE "campaignName" ILIKE '%VID%'
      `);
      for (const row of displayMatchedTargetData as any[]) {
        results.push(row);
      }

      // Query Display Targeting
      const displayTargetingData = await db.execute(sql`
        SELECT DISTINCT 
          'display_targeting' as source_table,
          "campaignId"::text as campaign_id,
          "campaignName" as campaign_name,
          COALESCE(country, '') as country,
          '' as campaign_status
        FROM s_display_targeting
        WHERE "campaignName" ILIKE '%VID%'
      `);
      for (const row of displayTargetingData as any[]) {
        results.push(row);
      }

      // Generate CSV
      const csvHeader = 'source_table,campaign_id,campaign_name,country,campaign_status';
      const csvRows = results.map(r => 
        `"${r.source_table}","${r.campaign_id}","${(r.campaign_name || '').replace(/"/g, '""')}","${r.country}","${r.campaign_status}"`
      );
      const csvContent = [csvHeader, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=vid-campaigns.csv');
      res.send(csvContent);
    } catch (error) {
      console.error('VID campaigns export error:', error);
      res.status(500).json({ error: 'Failed to export VID campaigns' });
    }
  });

  // Export bid recommendations as CSV - supports country, campaign, and ad group level exports
  app.get("/api/exports/recommendations.csv", async (req, res) => {
    try {
      const { adGroupId, campaignId, country, from, to } = req.query;
      
      const conditions = [];
      if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
      if (campaignId) conditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
      if (country) conditions.push(sql`${productSearchTerms.country} = ${country}`);
      if (from) conditions.push(gte(productSearchTerms.date, from as string));
      if (to) conditions.push(lte(productSearchTerms.date, to as string));

      // Include campaign and ad group names for context in country/campaign-level exports
      // Group by all context fields to ensure correct attribution
      const results = await db
        .select({
          targeting: productSearchTerms.targeting,
          matchType: productSearchTerms.matchType,
          campaignName: productSearchTerms.campaignName,
          adGroupName: productSearchTerms.adGroupName,
          keywordBid: sql<number>`MAX(${productSearchTerms.keywordBid})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          impressions: sql<number>`0`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(
          productSearchTerms.targeting, 
          productSearchTerms.matchType,
          productSearchTerms.campaignName,
          productSearchTerms.adGroupName
        );

      const targetingData = results.map(row => ({
        targeting: row.targeting || '',
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        cost: Number(row.cost),
        sales: Number(row.sales),
        orders: Number(row.orders),
        currentBid: Number(row.keywordBid || 0) || null,
        cpc: Number(row.clicks) > 0 ? Number(row.cost) / Number(row.clicks) : 0,
        matchType: row.matchType || undefined,
        campaignName: row.campaignName || undefined,
        adGroupName: row.adGroupName || undefined,
      }));

      const recommendations = generateBulkRecommendations(targetingData, 20);
      
      // Generate CSV with additional context columns for country/campaign exports
      const includeContext = !!(country || (campaignId && !adGroupId));
      const csvContent = formatRecommendationsForCSV(recommendations, includeContext);

      // Dynamic filename based on export level
      let filename = 'bid-recommendations';
      if (country) filename = `bid-recommendations-${country}`;
      else if (campaignId) filename = `bid-recommendations-campaign-${campaignId}`;
      else if (adGroupId) filename = `bid-recommendations-adgroup-${adGroupId}`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      res.send(csvContent);
    } catch (error) {
      console.error('Export recommendations error:', error);
      res.status(500).json({ error: 'Failed to export recommendations' });
    }
  });

  // Generate bid recommendations endpoint
  app.post("/api/recommendations/generate", async (req, res) => {
    try {
      const { scope, scopeId, campaignId, from, to, targetAcos: providedTargetAcos } = req.body;

      if (!scopeId) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      
      // Fetch campaign-specific ACOS target if campaignId provided
      let targetAcos = 20; // Default fallback
      if (campaignId) {
        const acosTarget = await getAcosTargetForCampaign(campaignId);
        if (acosTarget === null) {
          return res.status(400).json({ 
            error: 'ACOS target not configured',
            message: `No ACOS target found for campaign ${campaignId}. Please add it to the ACOS_Target_Campaign table.`,
            campaignId
          });
        }
        targetAcos = acosTarget * 100; // Convert from decimal (0.35) to percentage (35)
      } else if (providedTargetAcos !== undefined) {
        targetAcos = providedTargetAcos;
      }

      // Fetch search terms data for the scope (ad group)
      const brandConditions = [];
      const productConditions = [];
      
      if (scopeId) {
        brandConditions.push(sql`${brandSearchTerms.adGroupId}::text = ${scopeId}`);
        productConditions.push(sql`${productSearchTerms.adGroupId}::text = ${scopeId}`);
      }
      if (from) {
        brandConditions.push(gte(brandSearchTerms.date, from as string));
        productConditions.push(gte(productSearchTerms.date, from as string));
      }
      if (to) {
        brandConditions.push(lte(brandSearchTerms.date, to as string));
        productConditions.push(lte(productSearchTerms.date, to as string));
      }

      // Fetch brand search terms
      const brandResults = await db
        .select({
          searchTerm: brandSearchTerms.searchTerm,
          keywordBid: sql<number>`MAX(${brandSearchTerms.keywordBid})`,
          clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
          orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
        })
        .from(brandSearchTerms)
        .where(brandConditions.length > 0 ? and(...brandConditions) : undefined)
        .groupBy(brandSearchTerms.searchTerm);

      // Fetch product search terms
      const productResults = await db
        .select({
          searchTerm: productSearchTerms.searchTerm,
          keywordBid: sql<number>`MAX(${productSearchTerms.keywordBid})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(productConditions.length > 0 ? and(...productConditions) : undefined)
        .groupBy(productSearchTerms.searchTerm);

      // Combine brand + product data
      const searchTermMap = new Map();
      
      brandResults.forEach(row => {
        if (row.searchTerm) {
          searchTermMap.set(row.searchTerm, {
            searchTerm: row.searchTerm,
            keywordBid: Number(row.keywordBid || 0),
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            orders: Number(row.orders),
          });
        }
      });

      productResults.forEach(row => {
        if (row.searchTerm) {
          const existing = searchTermMap.get(row.searchTerm);
          if (existing) {
            existing.clicks += Number(row.clicks);
            existing.cost += Number(row.cost);
            existing.sales += Number(row.sales);
            existing.orders += Number(row.orders);
          } else {
            searchTermMap.set(row.searchTerm, {
              searchTerm: row.searchTerm,
              keywordBid: Number(row.keywordBid || 0),
              clicks: Number(row.clicks),
              cost: Number(row.cost),
              sales: Number(row.sales),
              orders: Number(row.orders),
            });
          }
        }
      });

      const combinedTerms = Array.from(searchTermMap.values());

      // Calculate ad group median CPC for context
      const cpcs = combinedTerms
        .filter(t => t.clicks > 0)
        .map(t => t.cost / t.clicks)
        .sort((a, b) => a - b);
      const adGroupMedianCPC = cpcs.length > 0 ? cpcs[Math.floor(cpcs.length / 2)] : 1.0;

      // Generate recommendations based on PPC AI Prompt logic
      const recommendations = combinedTerms
        .map(term => {
          const cpc = term.clicks > 0 ? term.cost / term.clicks : 0;
          const acos = term.sales > 0 ? (term.cost / term.sales) * 100 : 0;
          const cvr = term.clicks > 0 ? (term.orders / term.clicks) * 100 : 0;
          const confidence = getConfidenceLevel(term.clicks);

          // Skip if insufficient data (less than 30 clicks = Low confidence)
          if (term.clicks < 30) {
            return null;
          }

          const baseBid = term.keywordBid || cpc || adGroupMedianCPC;
          let proposedBid = baseBid;
          let rationale = '';

          // PPC AI Prompt Logic:
          // 1) No sales - reduce bid
          if (term.sales === 0 && term.clicks >= 30) {
            const reduction = term.clicks >= 100 ? 0.70 : 0.85; // -30% or -15%
            proposedBid = baseBid * reduction;
            rationale = `No sales with ${term.clicks} clicks. Reducing bid ${reduction === 0.70 ? '30%' : '15%'} to minimize waste.`;
          }
          // 2) ACOS below target range (< 16% when target is 20%)
          else if (acos > 0 && acos <= targetAcos * 0.8 && term.clicks >= 30) {
            const increase = term.clicks >= 300 ? 1.20 : term.clicks >= 100 ? 1.15 : 1.10;
            proposedBid = baseBid * increase;
            rationale = `ACOS ${acos.toFixed(1)}% well below target ${targetAcos}%. Increasing bid to capture more profitable volume. Confidence: ${confidence.label}`;
          }
          // 3) Standard formula: current bid / current ACOS * target ACOS = new bid
          // Only apply if ACOS is outside the acceptable window (±10% of target)
          else if (term.sales > 0 && acos > 0) {
            const lowerBound = targetAcos * 0.9;  // 10% below target
            const upperBound = targetAcos * 1.1;  // 10% above target
            
            // Skip if ACOS is within acceptable range (near target)
            if (acos >= lowerBound && acos <= upperBound) {
              return null; // ACOS is close enough to target, no action needed
            }
            
            proposedBid = baseBid * (targetAcos / acos);
            
            if (acos > upperBound) {
              rationale = `ACOS ${acos.toFixed(1)}% exceeds target ${targetAcos}%. Applying formula: ${baseBid.toFixed(2)} × (${targetAcos} / ${acos.toFixed(1)}) = ${proposedBid.toFixed(2)}. CVR: ${cvr.toFixed(1)}%`;
            } else if (acos < lowerBound) {
              rationale = `ACOS ${acos.toFixed(1)}% below target ${targetAcos}%. Optimizing bid for growth. CVR: ${cvr.toFixed(1)}%`;
            }
          } else {
            return null;
          }

          // Apply safeguards: 20% to 150% of base bid (per PPC AI guidelines)
          const minBid = baseBid * 0.20;
          const maxBid = baseBid * 1.50;
          proposedBid = Math.max(minBid, Math.min(maxBid, proposedBid));
          proposedBid = Math.round(proposedBid * 100) / 100;

          const delta = ((proposedBid - baseBid) / baseBid) * 100;

          return {
            searchTerm: term.searchTerm,
            currentBid: baseBid,
            proposedBid,
            clicks: term.clicks,
            cost: term.cost,
            sales: term.sales,
            orders: term.orders,
            acos: acos,
            targetAcos: targetAcos,
            cvr: cvr,
            cpc: cpc,
            delta: delta,
            confidence: confidence.label,
            rationale,
          };
        })
        .filter(rec => rec !== null)
        .sort((a, b) => {
          // Sort by confidence level first, then by clicks
          const confidenceOrder = { 'Extreme': 0, 'High': 1, 'Good': 2, 'OK': 3, 'Low': 4 };
          const confDiff = confidenceOrder[a!.confidence as keyof typeof confidenceOrder] - confidenceOrder[b!.confidence as keyof typeof confidenceOrder];
          if (confDiff !== 0) return confDiff;
          return b!.clicks - a!.clicks;
        });

      res.json({ 
        recommendations,
        summary: {
          totalAnalyzed: combinedTerms.length,
          recommendationsGenerated: recommendations.length,
          targetAcos: targetAcos,
          adGroupMedianCPC: adGroupMedianCPC.toFixed(2),
        }
      });

    } catch (error) {
      console.error('Recommendations generation error:', error);
      res.status(500).json({ error: 'Failed to generate recommendations' });
    }
  });

  // Attribution comparison endpoint - compare different attribution windows
  app.get("/api/attribution-comparison", async (req, res) => {
    try {
      const { from, to, country } = req.query;
      
      const conditions = [];
      if (from) conditions.push(gte(productSearchTerms.date, from as string));
      if (to) conditions.push(lte(productSearchTerms.date, to as string));
      if (country) conditions.push(eq(productSearchTerms.country, country as string));
      
      // First check what columns have data
      const sampleCheck = await db.execute(sql`
        SELECT 
          COUNT(*) as total_rows,
          COUNT(sales1d) as has_sales1d,
          COUNT(sales7d) as has_sales7d,
          COUNT(sales14d) as has_sales14d,
          COUNT(sales30d) as has_sales30d
        FROM s_products_search_terms
        WHERE date >= ${from} AND date <= ${to}
        ${country ? sql`AND country = ${country}` : sql``}
        LIMIT 1
      `);
      
      const result = await db
        .select({
          sales1d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales1d}, '')::numeric), 0)`,
          sales7d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          sales14d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales14d}, '')::numeric), 0)`,
          sales30d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
          orders1d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases1d}, '')::numeric), 0)`,
          orders7d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
          orders14d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases14d}, '')::numeric), 0)`,
          orders30d: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      const data = result[0];
      const sample = Array.isArray(sampleCheck) ? sampleCheck[0] : sampleCheck;
      
      res.json({
        period: { from, to },
        dataAvailability: sample,
        sales: {
          '1d': Number(data.sales1d),
          '7d': Number(data.sales7d),
          '14d': Number(data.sales14d),
          '30d': Number(data.sales30d),
        },
        orders: {
          '1d': Number(data.orders1d),
          '7d': Number(data.orders7d),
          '14d': Number(data.orders14d),
          '30d': Number(data.orders30d),
        },
        differences: {
          '7d_vs_1d': data.sales1d > 0 ? ((Number(data.sales7d) - Number(data.sales1d)) / Number(data.sales1d) * 100).toFixed(1) + '%' : 'N/A (no 1d data)',
          '14d_vs_7d': data.sales7d > 0 ? ((Number(data.sales14d) - Number(data.sales7d)) / Number(data.sales7d) * 100).toFixed(1) + '%' : 'N/A (no 7d data)',
          '30d_vs_14d': data.sales14d > 0 ? ((Number(data.sales30d) - Number(data.sales14d)) / Number(data.sales14d) * 100).toFixed(1) + '%' : 'N/A (no 14d data)',
        }
      });
    } catch (error: any) {
      console.error('Attribution comparison error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI Agent query endpoint - natural language PPC analytics
  app.post("/api/agent/query", async (req, res) => {
    try {
      const { message, stream = false } = req.body;
      
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required' });
      }
      
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'Anthropic API key not configured' });
      }
      
      if (stream) {
        // Streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        try {
          for await (const chunk of queryAgentStream(message)) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        } catch (streamError: any) {
          console.error('Agent streaming error:', streamError);
          res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
          res.end();
        }
      } else {
        // Non-streaming response
        const response = await queryAgent(message);
        res.json({ response });
      }
    } catch (error: any) {
      console.error('Agent query error:', error);
      res.status(500).json({ error: error.message || 'Failed to process query' });
    }
  });

  // Migration endpoint - creates bid_change_history table if not exists
  app.post("/api/migrations/bid-change-history", async (req, res) => {
    try {
      await createBidChangeHistoryTable();
      res.json({ success: true, message: 'bid_change_history table created/verified' });
    } catch (error: any) {
      console.error('Migration error:', error);
      res.status(500).json({ success: false, error: error.message || 'Migration failed' });
    }
  });

  // Detect bid changes - compares bids across consecutive dates and records changes
  // This should be run daily after new data is uploaded (also runs automatically via scheduler)
  app.post("/api/detect-bid-changes", async (req, res) => {
    try {
      const { detectBidChanges } = await import('./utils/bidChangeDetector');
      const result = await detectBidChanges();

      res.json({
        success: true,
        changesDetected: result,
        message: `Detected ${result.total} bid changes (${result.products} products, ${result.brands} brands)`
      });
    } catch (error: any) {
      console.error('Bid change detection error:', error);
      res.status(500).json({ success: false, error: error.message || 'Detection failed' });
    }
  });

  // Query bid change history
  app.get("/api/bid-history", async (req, res) => {
    try {
      const { targeting, campaignId, adGroupId, campaignType, from, to, limit: limitParam = '100' } = req.query;
      
      const conditions = [];
      if (targeting) conditions.push(sql`${bidChangeHistory.targeting} = ${targeting}`);
      if (campaignId) conditions.push(sql`${bidChangeHistory.campaignId} = ${Number(campaignId)}`);
      if (adGroupId) conditions.push(sql`${bidChangeHistory.adGroupId} = ${Number(adGroupId)}`);
      if (campaignType) conditions.push(eq(bidChangeHistory.campaignType, campaignType as string));
      if (from) conditions.push(gte(bidChangeHistory.dateAdjusted, from as string));
      if (to) conditions.push(lte(bidChangeHistory.dateAdjusted, to as string));

      const results = await db
        .select()
        .from(bidChangeHistory)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(bidChangeHistory.dateAdjusted))
        .limit(Number(limitParam));

      res.json(results);
    } catch (error: any) {
      console.error('Bid history query error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch bid history' });
    }
  });

  // Get last bid change for a specific targeting keyword
  app.get("/api/bid-history/last-change", async (req, res) => {
    try {
      const { targeting, campaignId, adGroupId } = req.query;
      
      if (!targeting || !campaignId) {
        return res.status(400).json({ error: 'targeting and campaignId are required' });
      }

      const conditions = [
        sql`${bidChangeHistory.targeting} = ${targeting}`,
        sql`${bidChangeHistory.campaignId} = ${Number(campaignId)}`
      ];
      if (adGroupId) conditions.push(sql`${bidChangeHistory.adGroupId} = ${Number(adGroupId)}`);

      const results = await db
        .select()
        .from(bidChangeHistory)
        .where(and(...conditions))
        .orderBy(desc(bidChangeHistory.dateAdjusted))
        .limit(1);

      if (results.length === 0) {
        return res.json({ found: false, message: 'No bid changes recorded for this targeting' });
      }

      res.json({ found: true, lastChange: results[0] });
    } catch (error: any) {
      console.error('Last bid change query error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch last bid change' });
    }
  });

  // Migration endpoint - creates ACOS_Target_Campaign table
  app.post("/api/migrations/acos-targets", async (req, res) => {
    try {
      await createAcosTargetsTable();
      res.json({ success: true, message: 'ACOS_Target_Campaign table created/verified' });
    } catch (error: any) {
      console.error('Migration error:', error);
      res.status(500).json({ success: false, error: error.message || 'Migration failed' });
    }
  });

  // Import ACOS targets from CSV
  app.post("/api/import-acos-targets", async (req, res) => {
    try {
      const result = await importAcosTargetsFromCSV();
      res.json({ 
        success: true, 
        imported: result.imported, 
        skipped: result.skipped,
        errors: result.errors,
        message: `Imported ${result.imported} campaigns, skipped ${result.skipped}` 
      });
    } catch (error: any) {
      console.error('Import error:', error);
      res.status(500).json({ success: false, error: error.message || 'Import failed' });
    }
  });

  // Get ACOS target for a specific campaign
  app.get("/api/acos-targets/:campaignId", async (req, res) => {
    try {
      const { campaignId } = req.params;
      const acosTarget = await getAcosTargetForCampaign(campaignId);
      
      if (acosTarget === null) {
        return res.status(404).json({ 
          error: 'ACOS target not found',
          message: `No ACOS target configured for campaign ${campaignId}. Please add it to the ACOS_Target_Campaign table.`
        });
      }
      
      res.json({ campaignId, acosTarget, acosTargetPercent: acosTarget * 100 });
    } catch (error: any) {
      console.error('ACOS target query error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch ACOS target' });
    }
  });

  // ========== BIDDING STRATEGY ENDPOINTS ==========
  
  // Create bidding strategy tables migration
  app.post("/api/migrations/bidding-strategy", async (req, res) => {
    try {
      await createWeightConfigTable();
      await createRecommendationHistoryTable();
      res.json({ success: true, message: 'Bidding strategy tables created successfully' });
    } catch (error: any) {
      console.error('Migration error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get weights for a country (or global default)
  app.get("/api/weights/:country?", async (req, res) => {
    try {
      const country = req.params.country || 'ALL';
      const weights = await getWeightsForCountry(country);
      res.json({ country, ...weights });
    } catch (error: any) {
      console.error('Error fetching weights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update weights for a country
  app.post("/api/weights/:country", async (req, res) => {
    try {
      const { country } = req.params;
      const { t0_weight, d30_weight, d365_weight, lifetime_weight } = req.body;
      
      // Validate weights sum to approximately 1
      const total = t0_weight + d30_weight + d365_weight + lifetime_weight;
      if (Math.abs(total - 1) > 0.01) {
        return res.status(400).json({ error: 'Weights must sum to 1.0', received: total });
      }
      
      await updateWeightsForCountry(country, { t0_weight, d30_weight, d365_weight, lifetime_weight });
      res.json({ success: true, country, t0_weight, d30_weight, d365_weight, lifetime_weight });
    } catch (error: any) {
      console.error('Error updating weights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all country weights
  app.get("/api/weights", async (req, res) => {
    try {
      const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
      const sqlClient = postgres(connectionUrl);
      const result = await sqlClient`SELECT * FROM "weight_config" ORDER BY country`;
      await sqlClient.end();
      res.json(result);
    } catch (error: any) {
      console.error('Error fetching all weights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Main bidding strategy endpoint - analyze and generate recommendations
  app.get("/api/bidding-strategy", async (req, res) => {
    try {
      const { country, campaignId } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }

      const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
      const sqlClient = postgres(connectionUrl);

      // Get weights for this country
      const weights = await getWeightsForCountry(country as string);
      
      // Get campaign-specific ACOS targets
      const acosTargetsResult = await sqlClient`
        SELECT campaign_id, acos_target, campaign_name 
        FROM "ACOS_Target_Campaign" 
        WHERE country = ${country as string}
      `;
      const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

      // Get last bid change dates for each keyword
      const bidChangeResult = await sqlClient`
        SELECT targeting, campaign_id, ad_group_id, MAX(date_adjusted) as last_change_date
        FROM "bid_change_history"
        WHERE country = ${country as string}
        ${campaignId ? sqlClient`AND campaign_id = ${campaignId as string}` : sqlClient``}
        GROUP BY targeting, campaign_id, ad_group_id
      `;
      const lastChangeMap = new Map(bidChangeResult.map((r: any) => [`${r.campaign_id}-${r.targeting}`, r.last_change_date]));

      // Calculate date ranges
      const today = new Date();
      const d30Ago = new Date(today);
      d30Ago.setDate(d30Ago.getDate() - 30);
      const d365Ago = new Date(today);
      d365Ago.setDate(d365Ago.getDate() - 365);
      const lifetimeStart = '2024-10-01';
      const d30AgoStr = d30Ago.toISOString().split('T')[0];
      const d365AgoStr = d365Ago.toISOString().split('T')[0];

      // Fetch keyword performance data with all time windows INCLUDING T0
      // T0 = data since last bid change (or lifetime if no change)
      const keywordData = await sqlClient`
        WITH last_changes AS (
          SELECT 
            targeting,
            campaign_id,
            ad_group_id,
            MAX(date_adjusted) as last_change_date
          FROM "bid_change_history"
          WHERE country = ${country as string}
          ${campaignId ? sqlClient`AND campaign_id = ${campaignId as string}` : sqlClient``}
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
          WHERE s.country = ${country as string}
          ${campaignId ? sqlClient`AND s."campaignId" = ${campaignId as string}` : sqlClient``}
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
          
          -- Lifetime metrics
          SUM(clicks) as lifetime_clicks,
          SUM(cost) as lifetime_cost,
          SUM(sales) as lifetime_sales,
          SUM(orders) as lifetime_orders,
          
          -- 365D metrics
          SUM(CASE WHEN date >= ${d365AgoStr} THEN clicks ELSE 0 END) as d365_clicks,
          SUM(CASE WHEN date >= ${d365AgoStr} THEN cost ELSE 0 END) as d365_cost,
          SUM(CASE WHEN date >= ${d365AgoStr} THEN sales ELSE 0 END) as d365_sales,
          
          -- 30D metrics
          SUM(CASE WHEN date >= ${d30AgoStr} THEN clicks ELSE 0 END) as d30_clicks,
          SUM(CASE WHEN date >= ${d30AgoStr} THEN cost ELSE 0 END) as d30_cost,
          SUM(CASE WHEN date >= ${d30AgoStr} THEN sales ELSE 0 END) as d30_sales,
          
          -- T0 metrics (since last change, or all data if no change)
          SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN clicks ELSE 0 END) as t0_clicks,
          SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN cost ELSE 0 END) as t0_cost,
          SUM(CASE WHEN last_change_date IS NULL OR date >= last_change_date THEN sales ELSE 0 END) as t0_sales,
          
          MIN(date) as first_date,
          MAX(date) as last_date
        FROM keyword_base
        GROUP BY campaign_id, campaign_name, ad_group_id, ad_group_name, targeting, match_type
        HAVING SUM(clicks) >= 30
        ORDER BY SUM(cost) DESC
        LIMIT 500
      `;

      const recommendations: any[] = [];
      const combinedActions: any[] = [];

      for (const kw of keywordData) {
        const campaignTarget = acosTargetsMap.get(kw.campaign_id);
        if (!campaignTarget) continue; // Skip campaigns without ACOS target

        const targetAcos = campaignTarget.target;
        const acosWindow = 0.03; // ±3%

        // T0 metrics are now pre-calculated in the SQL query
        const t0Clicks = Number(kw.t0_clicks);
        const t0Cost = Number(kw.t0_cost);
        const t0Sales = Number(kw.t0_sales);
        const lastChangeDate = kw.last_change_date;

        // Calculate ACOS for each period
        const t0Acos = t0Sales > 0 ? t0Cost / t0Sales : (t0Clicks >= 30 ? 999 : null);
        const d30Acos = Number(kw.d30_sales) > 0 ? Number(kw.d30_cost) / Number(kw.d30_sales) : (Number(kw.d30_clicks) >= 30 ? 999 : null);
        const d365Acos = Number(kw.d365_sales) > 0 ? Number(kw.d365_cost) / Number(kw.d365_sales) : (Number(kw.d365_clicks) >= 30 ? 999 : null);
        const lifetimeAcos = Number(kw.lifetime_sales) > 0 ? Number(kw.lifetime_cost) / Number(kw.lifetime_sales) : (Number(kw.lifetime_clicks) >= 30 ? 999 : null);

        // Check cooldown (14 days for keyword bids)
        const daysSinceChange = lastChangeDate 
          ? Math.floor((today.getTime() - new Date(lastChangeDate).getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        
        if (daysSinceChange < 14) continue; // Skip if within cooldown

        // Calculate weighted ACOS
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

        // Check if outside ±3% window
        const lowerBound = targetAcos - acosWindow;
        const upperBound = targetAcos + acosWindow;
        
        if (weightedAcos >= lowerBound && weightedAcos <= upperBound) continue; // Within window, no action

        // Calculate recommended bid change
        const currentBid = Number(kw.current_bid) || 0;
        if (currentBid <= 0) continue;

        // Bid adjustment formula: new_bid = current_bid * (target_acos / weighted_acos)
        let bidMultiplier = targetAcos / weightedAcos;
        bidMultiplier = Math.max(0.5, Math.min(1.5, bidMultiplier)); // Cap at ±50%
        const recommendedBid = Math.round(currentBid * bidMultiplier * 100) / 100;

        // Determine confidence based on click volume
        const totalClicks = Number(kw.lifetime_clicks);
        let confidence = 'Low';
        if (totalClicks >= 200) confidence = 'Extreme';
        else if (totalClicks >= 100) confidence = 'High';
        else if (totalClicks >= 50) confidence = 'Good';
        else if (totalClicks >= 30) confidence = 'OK';

        const action = weightedAcos > targetAcos ? 'decrease' : 'increase';
        const changePercent = Math.round((bidMultiplier - 1) * 100);

        recommendations.push({
          type: 'keyword_bid',
          country: country,
          campaign_id: kw.campaign_id,
          campaign_name: kw.campaign_name,
          ad_group_id: kw.ad_group_id,
          ad_group_name: kw.ad_group_name,
          targeting: kw.targeting,
          match_type: kw.match_type,
          current_bid: currentBid,
          recommended_bid: recommendedBid,
          change_percent: changePercent,
          action: action,
          acos_target: targetAcos,
          acos_target_percent: Math.round(targetAcos * 100),
          weighted_acos: weightedAcos,
          weighted_acos_percent: Math.round(weightedAcos * 100),
          t0_acos: t0Acos !== 999 ? t0Acos : null,
          t0_clicks: t0Clicks,
          d30_acos: d30Acos !== 999 ? d30Acos : null,
          d30_clicks: Number(kw.d30_clicks),
          d365_acos: d365Acos !== 999 ? d365Acos : null,
          d365_clicks: Number(kw.d365_clicks),
          lifetime_acos: lifetimeAcos !== 999 ? lifetimeAcos : null,
          lifetime_clicks: totalClicks,
          confidence: confidence,
          days_since_change: daysSinceChange,
          last_change_date: lastChangeDate || null,
          reason: `Weighted ACOS (${Math.round(weightedAcos * 100)}%) is ${action === 'decrease' ? 'above' : 'below'} target (${Math.round(targetAcos * 100)}%)`
        });
      }

      // Cross-check: which campaigns also have placement adjustments needed?
      // Get unique campaign IDs from keyword recommendations
      const campaignIds = Array.from(new Set(recommendations.map(r => r.campaign_id)));
      const campaignsWithPlacementRecs = new Set<string>();
      
      if (campaignIds.length > 0) {
        // For each campaign, check if there are placements with recommended changes
        // Query placement data for campaigns with keyword recs
        const placementData = await sqlClient`
          SELECT 
            "campaignId"::text as campaign_id,
            "placementClassification" as placement,
            SUM(COALESCE(NULLIF(clicks, '')::numeric, 0)) as clicks,
            SUM(COALESCE(NULLIF(cost, '')::numeric, 0)) as cost,
            SUM(COALESCE(NULLIF("sales30d", '')::numeric, 0)) as sales
          FROM "s_products_placement"
          WHERE country = ${country as string}
            AND "campaignId"::text = ANY(${campaignIds})
          GROUP BY "campaignId", "placementClassification"
          HAVING SUM(COALESCE(NULLIF(clicks, '')::numeric, 0)) >= 30
        `;
        
        // Get ACOS targets for these campaigns
        for (const row of placementData) {
          const campaignTarget = acosTargetsMap.get(row.campaign_id);
          if (!campaignTarget) continue;
          
          const targetAcos = campaignTarget.target * 100; // Convert to percentage
          const clicks = Number(row.clicks);
          const cost = Number(row.cost);
          const sales = Number(row.sales);
          const acos = sales > 0 ? (cost / sales) * 100 : 0;
          
          // Check if a placement adjustment would be recommended
          let hasRecommendation = false;
          if (clicks >= 30) {
            if (sales === 0) {
              hasRecommendation = true; // No sales = recommend decrease
            } else if (acos <= targetAcos * 0.8 || acos > targetAcos * 1.1) {
              hasRecommendation = true; // Outside ±10% window
            }
          }
          
          if (hasRecommendation) {
            campaignsWithPlacementRecs.add(row.campaign_id);
          }
        }
      }
      
      // Add hasPlacementRecs flag to each recommendation
      const enrichedRecommendations = recommendations.map(rec => ({
        ...rec,
        hasPlacementRecs: campaignsWithPlacementRecs.has(rec.campaign_id),
      }));

      await sqlClient.end();

      res.json({
        country,
        weights,
        total_recommendations: enrichedRecommendations.length,
        recommendations: enrichedRecommendations.slice(0, 100), // Limit response size
        combined_actions: combinedActions,
        campaigns_with_both: Array.from(campaignsWithPlacementRecs),
      });
    } catch (error: any) {
      console.error('Bidding strategy error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Live placement bidding strategy endpoint - returns placement recommendations without saving
  app.get("/api/placement-bidding-strategy", async (req, res) => {
    try {
      const { country, campaignId } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }

      const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
      const sqlClient = postgres(connectionUrl);
      const MIN_CLICKS = 30;
      const ACOS_WINDOW = 10; // ±10% window for placements

      // Get ACOS targets for campaigns in this country
      const acosTargetsResult = await sqlClient`
        SELECT campaign_id, acos_target, campaign_name 
        FROM "ACOS_Target_Campaign" 
        WHERE country = ${country as string}
      `;
      const acosTargetsMap = new Map(acosTargetsResult.map((r: any) => [r.campaign_id, { target: Number(r.acos_target), name: r.campaign_name }]));

      // Query placement data grouped by campaign (no bid adjustment column in raw data)
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
        WHERE country = ${country as string}
          AND "placementClassification" IS NOT NULL
          ${campaignId ? sqlClient`AND "campaignId" = ${campaignId as string}` : sqlClient``}
        GROUP BY "campaignId", "campaignName", "placementClassification"
        HAVING SUM(COALESCE(NULLIF(clicks, '')::numeric, 0)) >= ${MIN_CLICKS}
        ORDER BY SUM(COALESCE(NULLIF(cost, '')::numeric, 0)) DESC
      `;

      const recommendations: any[] = [];

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

        // Skip if ACOS is within target window (±10%)
        if (acos !== 999 && acos >= targetAcos - ACOS_WINDOW && acos <= targetAcos + ACOS_WINDOW) {
          continue;
        }

        // Calculate target bid adjustment (never below 0%)
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

        // Determine confidence
        let confidence = 'Low';
        if (clicks >= 200) confidence = 'Extreme';
        else if (clicks >= 100) confidence = 'High';
        else if (clicks >= 50) confidence = 'Good';
        else if (clicks >= MIN_CLICKS) confidence = 'OK';

        const action = acos > targetAcos ? 'decrease' : 'increase';

        recommendations.push({
          campaignId: p.campaign_id,
          campaignName: p.campaign_name,
          placement: p.placement,
          biddingStrategy: 'N/A',
          currentAdjustment,
          recommendedAdjustment: targetAdjustment,
          change: targetAdjustment - currentAdjustment,
          clicks,
          cost,
          sales,
          acos: acos === 999 ? null : acos / 100,
          targetAcos: campaignTarget.target,
          confidence,
          reason: `Placement ACOS (${acos === 999 ? 'No Sales' : acos.toFixed(1) + '%'}) ${action === 'decrease' ? 'exceeds' : 'below'} target range (${(targetAcos - ACOS_WINDOW).toFixed(0)}%-${(targetAcos + ACOS_WINDOW).toFixed(0)}%)`
        });
      }

      await sqlClient.end();

      res.json({
        country,
        total_recommendations: recommendations.length,
        recommendations: recommendations.slice(0, 200)
      });
    } catch (error: any) {
      console.error('Placement bidding strategy error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark recommendation as implemented
  app.post("/api/recommendation/:id/implement", async (req, res) => {
    try {
      const { id } = req.params;
      await markRecommendationImplemented(parseInt(id));
      res.json({ success: true, id });
    } catch (error: any) {
      console.error('Error marking implemented:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Save a new recommendation
  app.post("/api/recommendations/save", async (req, res) => {
    try {
      const recId = await saveRecommendation(req.body);
      res.json({ success: true, id: recId });
    } catch (error: any) {
      console.error('Error saving recommendation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get recommendation history
  app.get("/api/recommendation-history", async (req, res) => {
    try {
      const { country, campaign_id, implemented_only, limit } = req.query;
      const history = await getRecommendationHistory({
        country: country as string,
        campaign_id: campaign_id as string,
        implemented_only: implemented_only === 'true',
        limit: limit ? parseInt(limit as string) : 100
      });
      res.json(history);
    } catch (error: any) {
      console.error('Error fetching history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Manual trigger for daily recommendation generation (for testing/on-demand)
  app.post("/api/recommendations/generate-daily", async (req, res) => {
    try {
      const { generateDailyRecommendations } = await import('./utils/recommendationGenerator');
      const result = await generateDailyRecommendations();
      res.json({ 
        success: true, 
        message: 'Recommendations generated successfully',
        ...result
      });
    } catch (error: any) {
      console.error('Error generating recommendations:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate recommendations for a single country (faster than all countries)
  app.post("/api/recommendations/generate/:country", async (req, res) => {
    try {
      const { country } = req.params;
      const { generateRecommendationsForCountry } = await import('./utils/recommendationGenerator');
      const result = await generateRecommendationsForCountry(country);
      res.json({ 
        success: true, 
        message: `Recommendations generated for ${country}`,
        country,
        ...result
      });
    } catch (error: any) {
      console.error('Error generating recommendations:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Unified export with both keyword bids AND placement adjustments
  app.get("/api/exports/bid-recommendations.xlsx", async (req, res) => {
    try {
      const { country, campaignId } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }

      const countryStr = country as string;
      const campaignIdFilter = campaignId as string | undefined;
      const wb = XLSX.utils.book_new();
      
      // Get weights for this country
      const weights = await getWeightsForCountry(countryStr);
      const t0WeightPct = Math.round(weights.t0_weight * 100);
      const d30WeightPct = Math.round(weights.d30_weight * 100);
      const d365WeightPct = Math.round(weights.d365_weight * 100);
      const lifetimeWeightPct = Math.round(weights.lifetime_weight * 100);

      // First try recommendation_history, fallback to live API
      let keywordRecs: any[] = [];
      let placementRecs: any[] = [];
      
      // Try to get from recommendation_history first
      const historyQuery = campaignIdFilter
        ? sql`SELECT * FROM recommendation_history WHERE country = ${countryStr} AND campaign_id = ${campaignIdFilter} AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`
        : sql`SELECT * FROM recommendation_history WHERE country = ${countryStr} AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC`;
      
      const historyRecs = await db.execute(historyQuery);
      keywordRecs = (historyRecs as any[]).filter((r: any) => r.recommendation_type === 'keyword_bid');
      placementRecs = (historyRecs as any[]).filter((r: any) => r.recommendation_type === 'placement_adjustment');
      
      // If no recommendations in history, fetch live from bidding-strategy API
      if (keywordRecs.length === 0) {
        const host = req.get('host') || 'localhost:5000';
        const protocol = req.protocol || 'http';
        const strategyUrl = campaignIdFilter 
          ? `${protocol}://${host}/api/bidding-strategy?country=${countryStr}&campaignId=${campaignIdFilter}`
          : `${protocol}://${host}/api/bidding-strategy?country=${countryStr}`;
        
        const strategyResponse = await fetch(strategyUrl);
        if (strategyResponse.ok) {
          const strategyData = await strategyResponse.json();
          // Convert bidding-strategy format to recommendation format
          keywordRecs = (strategyData.recommendations || []).map((rec: any) => ({
            country: countryStr,
            campaign_id: rec.campaignId,
            campaign_name: rec.campaignName,
            ad_group_name: rec.adGroupName,
            targeting: rec.targeting,
            match_type: rec.matchType,
            old_value: rec.currentBid,
            recommended_value: rec.recommendedBid,
            weighted_acos: rec.weightedAcos,
            acos_target: rec.targetAcos,
            pre_acos_t0: rec.t0Acos,
            pre_acos_30d: rec.d30Acos,
            pre_acos_365d: rec.d365Acos,
            pre_acos_lifetime: rec.lifetimeAcos,
            pre_clicks_lifetime: rec.totalClicks,
            confidence: rec.confidence,
            reason: rec.reason
          }));
        }
      }

      // If no placement recommendations in history, fetch live from placement-bidding-strategy API
      if (placementRecs.length === 0) {
        const host = req.get('host') || 'localhost:5000';
        const protocol = req.protocol || 'http';
        const placementUrl = campaignIdFilter 
          ? `${protocol}://${host}/api/placement-bidding-strategy?country=${countryStr}&campaignId=${campaignIdFilter}`
          : `${protocol}://${host}/api/placement-bidding-strategy?country=${countryStr}`;
        
        const placementResponse = await fetch(placementUrl);
        if (placementResponse.ok) {
          const placementData = await placementResponse.json();
          // Convert placement-bidding-strategy format to recommendation format
          placementRecs = (placementData.recommendations || []).map((rec: any) => ({
            country: countryStr,
            campaign_id: rec.campaignId,
            campaign_name: rec.campaignName,
            targeting: rec.placement,
            match_type: rec.biddingStrategy,
            old_value: rec.currentAdjustment,
            recommended_value: rec.recommendedAdjustment,
            weighted_acos: rec.acos,
            acos_target: rec.targetAcos,
            pre_clicks_lifetime: rec.clicks,
            confidence: rec.confidence,
            reason: rec.reason
          }));
        }
      }

      // Build set of campaigns with placement recommendations
      const campaignsWithPlacements = new Set(
        (placementRecs as any[]).map((r: any) => r.campaign_id)
      );
      
      // Build set of campaigns with keyword recommendations
      const campaignsWithKeywords = new Set(
        (keywordRecs as any[]).map((r: any) => r.campaign_id)
      );

      // Create keyword recommendations sheet
      const keywordData = (keywordRecs as any[]).map((rec: any) => {
        const hasBoth = campaignsWithPlacements.has(rec.campaign_id);
        const timeframesUsed: string[] = [];
        if (rec.pre_acos_t0 !== null && rec.pre_acos_t0 !== undefined) timeframesUsed.push('T0');
        if (rec.pre_acos_30d !== null && rec.pre_acos_30d !== undefined) timeframesUsed.push('30D');
        if (rec.pre_acos_365d !== null && rec.pre_acos_365d !== undefined) timeframesUsed.push('365D');
        if (rec.pre_acos_lifetime !== null && rec.pre_acos_lifetime !== undefined) timeframesUsed.push('Lifetime');
        
        const oldVal = Number(rec.old_value) || 0;
        const newVal = Number(rec.recommended_value) || 0;
        const changePercent = oldVal > 0 
          ? Math.round(((newVal - oldVal) / oldVal) * 100)
          : 0;
        
        const acosTarget = Number(rec.acos_target) || 0;
        const weightedAcos = Number(rec.weighted_acos) || 0;
        
        // Calculate CPC values (Cost Per Click)
        const calcCpc = (cost: number | null, clicks: number | null) => {
          if (cost === null || clicks === null || clicks === 0) return null;
          return Number(cost) / Number(clicks);
        };
        
        const d30Clicks = Number(rec.pre_clicks_30d) || 0;
        const d30Cost = Number(rec.pre_cost_30d) || 0;
        const d30Orders = Number(rec.pre_orders_30d) || 0;
        const d30Cpc = calcCpc(d30Cost, d30Clicks);
        
        const t0Clicks = Number(rec.pre_clicks_t0) || 0;
        const t0Cost = Number(rec.pre_cost_t0) || 0;
        const t0Orders = Number(rec.pre_orders_t0) || 0;
        const t0Cpc = calcCpc(t0Cost, t0Clicks);
        
        const d365Clicks = Number(rec.pre_clicks_365d) || 0;
        const d365Cost = Number(rec.pre_cost_365d) || 0;
        const d365Orders = Number(rec.pre_orders_365d) || 0;
        const d365Cpc = calcCpc(d365Cost, d365Clicks);
        
        const lifetimeClicks = Number(rec.pre_clicks_lifetime) || 0;
        const lifetimeCost = Number(rec.pre_cost_lifetime) || 0;
        const lifetimeOrders = Number(rec.pre_orders_lifetime) || 0;
        const lifetimeCpc = calcCpc(lifetimeCost, lifetimeClicks);
        
        return {
          'NEEDS BOTH ADJUSTMENTS': hasBoth ? 'YES - ALSO CHECK PLACEMENTS' : '',
          'Country': rec.country,
          'Campaign Name': rec.campaign_name,
          'Ad Group Name': rec.ad_group_name || '',
          'Targeting': rec.targeting,
          'Match Type': rec.match_type,
          'Current Bid': `€${oldVal.toFixed(2)}`,
          'Recommended Bid': `€${newVal.toFixed(2)}`,
          'Change %': `${changePercent}%`,
          'Action': newVal > oldVal ? 'increase' : 'decrease',
          'ACOS Target': `${Math.round(acosTarget * 100)}%`,
          'Weighted ACOS': `${Math.round(weightedAcos * 100)}%`,
          'Confidence': rec.confidence || '',
          '30D Clicks': d30Clicks,
          '30D CPC': d30Cpc !== null ? `€${d30Cpc.toFixed(2)}` : 'N/A',
          '30D Spend': `€${d30Cost.toFixed(2)}`,
          '30D Orders': d30Orders,
          '30D ACOS': rec.pre_acos_30d != null ? `${Math.round(Number(rec.pre_acos_30d) * 100)}%` : 'N/A',
          'T0 Clicks': t0Clicks,
          'T0 CPC': t0Cpc !== null ? `€${t0Cpc.toFixed(2)}` : 'N/A',
          'T0 Spend': `€${t0Cost.toFixed(2)}`,
          'T0 Orders': t0Orders,
          'T0 ACOS': rec.pre_acos_t0 != null ? `${Math.round(Number(rec.pre_acos_t0) * 100)}%` : 'N/A',
          '365D Clicks': d365Clicks,
          '365D CPC': d365Cpc !== null ? `€${d365Cpc.toFixed(2)}` : 'N/A',
          '365D Spend': `€${d365Cost.toFixed(2)}`,
          '365D Orders': d365Orders,
          '365D ACOS': rec.pre_acos_365d != null ? `${Math.round(Number(rec.pre_acos_365d) * 100)}%` : 'N/A',
          'Lifetime Clicks': lifetimeClicks,
          'Lifetime CPC': lifetimeCpc !== null ? `€${lifetimeCpc.toFixed(2)}` : 'N/A',
          'Lifetime Spend': `€${lifetimeCost.toFixed(2)}`,
          'Lifetime Orders': lifetimeOrders,
          'Lifetime ACOS': rec.pre_acos_lifetime != null ? `${Math.round(Number(rec.pre_acos_lifetime) * 100)}%` : 'N/A',
          'Reason': rec.reason || ''
        };
      });

      // Create placement recommendations sheet
      const placementData = (placementRecs as any[]).map((rec: any) => {
        const hasBoth = campaignsWithKeywords.has(rec.campaign_id);
        
        // Ensure recommended adjustment is never below 0%
        const recommendedAdj = Math.max(0, Number(rec.recommended_value) || 0);
        const currentAdj = Number(rec.old_value) || 0;
        const change = recommendedAdj - currentAdj;
        
        return {
          'NEEDS BOTH ADJUSTMENTS': hasBoth ? 'YES - ALSO CHECK KEYWORDS' : '',
          'Country': rec.country,
          'Campaign Name': rec.campaign_name,
          'Placement': rec.targeting,
          'Bidding Strategy': rec.match_type || 'N/A',
          'Current Adjustment': `${currentAdj}%`,
          'Recommended Adjustment': `${recommendedAdj}%`,
          'Change': `${change > 0 ? '+' : ''}${change}%`,
          'Clicks': rec.pre_clicks_lifetime || 0,
          'ACOS': rec.weighted_acos ? `${Math.round(rec.weighted_acos * 100)}%` : 'N/A',
          'Target ACOS': `${Math.round((rec.acos_target || 0) * 100)}%`,
          'Confidence': rec.confidence || '',
          'Reason': rec.reason || ''
        };
      });

      // Add sheets to workbook
      if (keywordData.length > 0) {
        const wsKeywords = XLSX.utils.json_to_sheet(keywordData);
        XLSX.utils.book_append_sheet(wb, wsKeywords, 'Keyword Bid Changes');
      }

      if (placementData.length > 0) {
        const wsPlacements = XLSX.utils.json_to_sheet(placementData);
        XLSX.utils.book_append_sheet(wb, wsPlacements, 'Placement Adjustments');
      }

      // Add summary sheet with campaigns needing both adjustments
      const campaignsNeedingBoth = Array.from(campaignsWithPlacements)
        .filter(cId => campaignsWithKeywords.has(cId as string));
      
      if (campaignsNeedingBoth.length > 0) {
        const bothData = campaignsNeedingBoth.map(cId => {
          const keywordCount = (keywordRecs as any[]).filter(r => r.campaign_id === cId).length;
          const placementCount = (placementRecs as any[]).filter(r => r.campaign_id === cId).length;
          const campaignName = (keywordRecs as any[]).find(r => r.campaign_id === cId)?.campaign_name || 
                              (placementRecs as any[]).find(r => r.campaign_id === cId)?.campaign_name || cId;
          return {
            'Campaign ID': cId,
            'Campaign Name': campaignName,
            'Keyword Bid Changes': keywordCount,
            'Placement Adjustments': placementCount,
            'Total Changes Needed': keywordCount + placementCount,
            'Priority': 'HIGH - Review Both Types'
          };
        });
        const wsBoth = XLSX.utils.json_to_sheet(bothData);
        XLSX.utils.book_append_sheet(wb, wsBoth, 'PRIORITY - Needs Both');
      }

      // Add metadata sheet
      const metadataData = [{
        'Export Date': new Date().toISOString().split('T')[0],
        'Country': countryStr,
        'Campaign Filter': campaignIdFilter || 'All Campaigns',
        'T0 Weight': `${t0WeightPct}%`,
        '30D Weight': `${d30WeightPct}%`,
        '365D Weight': `${d365WeightPct}%`,
        'Lifetime Weight': `${lifetimeWeightPct}%`,
        'Total Keyword Changes': keywordData.length,
        'Total Placement Changes': placementData.length,
        'Campaigns Needing Both': campaignsNeedingBoth.length,
        'Note': 'Recommendations generated daily at 3:00 AM UTC. Items marked "NEEDS BOTH ADJUSTMENTS" require attention in both sheets.'
      }];
      const wsMetadata = XLSX.utils.json_to_sheet(metadataData);
      XLSX.utils.book_append_sheet(wb, wsMetadata, 'Export Info');

      // If no recommendations found
      if (keywordData.length === 0 && placementData.length === 0) {
        const emptyData = [{
          'Message': 'No recommendations found for the selected filters',
          'Country': countryStr,
          'Campaign': campaignIdFilter || 'All',
          'Suggestion': 'Recommendations are generated daily at 3:00 AM UTC. Check back after the next generation run.'
        }];
        const wsEmpty = XLSX.utils.json_to_sheet(emptyData);
        XLSX.utils.book_append_sheet(wb, wsEmpty, 'No Data');
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = campaignIdFilter 
        ? `bid-recommendations-${countryStr}-campaign-${new Date().toISOString().split('T')[0]}.xlsx`
        : `bid-recommendations-${countryStr}-${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Export bid recommendations error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Legacy export endpoint (kept for backward compatibility)
  app.get("/api/exports/bidding-strategy.xlsx", async (req, res) => {
    try {
      const { country } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }

      // Fetch recommendations using the same logic (use request host to avoid hardcoded localhost)
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      const strategyResponse = await fetch(`${protocol}://${host}/api/bidding-strategy?country=${country}`);
      const strategyData = await strategyResponse.json();

      // Get weights for this country to include in export
      const weights = strategyData.weights || { t0_weight: 0.35, d30_weight: 0.25, d365_weight: 0.25, lifetime_weight: 0.15 };
      const t0WeightPct = Math.round(weights.t0_weight * 100);
      const d30WeightPct = Math.round(weights.d30_weight * 100);
      const d365WeightPct = Math.round(weights.d365_weight * 100);
      const lifetimeWeightPct = Math.round(weights.lifetime_weight * 100);
      
      const exportData = strategyData.recommendations.map((rec: any) => {
        // Determine which timeframes were used (have valid ACOS data)
        const timeframesUsed: string[] = [];
        if (rec.t0_acos !== null) timeframesUsed.push('T0');
        if (rec.d30_acos !== null) timeframesUsed.push('30D');
        if (rec.d365_acos !== null) timeframesUsed.push('365D');
        if (rec.lifetime_acos !== null) timeframesUsed.push('Lifetime');
        
        return {
          'Country': rec.country,
          'Campaign Name': rec.campaign_name,
          'Ad Group Name': rec.ad_group_name,
          'Targeting': rec.targeting,
          'Match Type': rec.match_type,
          'Current Bid': rec.current_bid,
          'Recommended Bid': rec.recommended_bid,
          'Change %': `${rec.change_percent}%`,
          'Action': rec.action,
          'ACOS Target': `${rec.acos_target_percent}%`,
          'Weighted ACOS': `${rec.weighted_acos_percent}%`,
          'T0 ACOS': rec.t0_acos ? `${Math.round(rec.t0_acos * 100)}%` : 'N/A',
          'T0 Clicks': rec.t0_clicks,
          '30D ACOS': rec.d30_acos ? `${Math.round(rec.d30_acos * 100)}%` : 'N/A',
          '30D Clicks': rec.d30_clicks,
          '365D ACOS': rec.d365_acos ? `${Math.round(rec.d365_acos * 100)}%` : 'N/A',
          '365D Clicks': rec.d365_clicks,
          'Lifetime ACOS': rec.lifetime_acos ? `${Math.round(rec.lifetime_acos * 100)}%` : 'N/A',
          'Lifetime Clicks': rec.lifetime_clicks,
          'Confidence': rec.confidence,
          'Days Since Change': rec.days_since_change,
          'Reason': rec.reason,
          'Has Placement Recs': rec.hasPlacementRecs ? 'YES - NEEDS BOTH ADJUSTMENTS' : 'No'
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Keyword Recommendations');

      // Add conditional formatting note to highlight rows needing both adjustments
      // Since xlsx library doesn't support conditional formatting directly,
      // we add a "Combined Adjustments" sheet with only those records
      const combinedRecs = exportData.filter((rec: any) => rec['Has Placement Recs'].startsWith('YES'));
      if (combinedRecs.length > 0) {
        const wsCombined = XLSX.utils.json_to_sheet(combinedRecs);
        XLSX.utils.book_append_sheet(wb, wsCombined, 'Needs Both Adjustments');
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="bidding-strategy-${country}-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Export error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export campaign placements to Excel
  app.get("/api/exports/campaign-placements.xlsx", async (req, res) => {
    try {
      const { campaignId, country } = req.query;
      
      if (!campaignId) {
        return res.status(400).json({ error: 'campaignId parameter is required' });
      }

      // Fetch placements using the same logic (use request host to avoid hardcoded localhost)
      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      const placementsResponse = await fetch(`${protocol}://${host}/api/campaign-placements?campaignId=${campaignId}${country ? `&country=${country}` : ''}`);
      const placementsData = await placementsResponse.json();

      const placements = placementsData.placements || [];
      const hasKeywordRecs = placementsData.hasKeywordRecs || false;
      const keywordRecCount = placementsData.keywordRecCount || 0;

      const exportData = placements.map((p: any) => ({
        'Campaign ID': campaignId,
        'Placement': p.placement,
        'Bidding Strategy': p.biddingStrategy || 'N/A',
        'Current Bid Adjustment': p.bidAdjustment !== null ? `${p.bidAdjustment}%` : 'Not set',
        'Target Bid Adjustment': p.targetBidAdjustment !== null ? `${p.targetBidAdjustment}%` : 'N/A',
        'Impressions': p.impressions,
        'Clicks': p.clicks,
        'CTR': p.ctr ? `${p.ctr.toFixed(2)}%` : 'N/A',
        'Spend (EUR)': p.spend?.toFixed(2) || '0.00',
        'Sales (EUR)': p.sales?.toFixed(2) || '0.00',
        'ACOS': p.acos ? `${p.acos.toFixed(1)}%` : 'N/A',
        'Orders': p.orders,
        'CPC (EUR)': p.cpc?.toFixed(2) || '0.00',
        'CVR': p.cvr ? `${p.cvr.toFixed(2)}%` : 'N/A',
        'Has Keyword Recs': hasKeywordRecs ? `YES - ${keywordRecCount} keyword adjustments needed` : 'No'
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Placement Adjustments');

      // Add summary sheet if this campaign needs keyword adjustments too
      if (hasKeywordRecs) {
        const summaryData = [{
          'Notice': 'This campaign also has keyword bid recommendations',
          'Keyword Adjustment Count': keywordRecCount,
          'Recommendation': 'Review keyword bids on the Bidding Strategy page for comprehensive optimization'
        }];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Cross-Reference Note');
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const campaignName = placements[0]?.campaignName?.replace(/[^a-zA-Z0-9]/g, '_') || campaignId;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="placements-${campaignName}-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Export placements error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Combined export with both keyword bids and placement adjustments
  app.get("/api/exports/combined-recommendations.xlsx", async (req, res) => {
    try {
      const { country, campaignId } = req.query;
      
      if (!country) {
        return res.status(400).json({ error: 'Country parameter is required' });
      }

      const host = req.get('host') || 'localhost:5000';
      const protocol = req.protocol || 'http';
      const wb = XLSX.utils.book_new();

      // Fetch keyword recommendations
      const strategyUrl = campaignId 
        ? `${protocol}://${host}/api/bidding-strategy?country=${country}&campaignId=${campaignId}`
        : `${protocol}://${host}/api/bidding-strategy?country=${country}`;
      const strategyResponse = await fetch(strategyUrl);
      const strategyData = await strategyResponse.json();

      // Get weights for metadata
      const weights = strategyData.weights || { t0_weight: 0.35, d30_weight: 0.25, d365_weight: 0.25, lifetime_weight: 0.15 };
      const t0WeightPct = Math.round(weights.t0_weight * 100);
      const d30WeightPct = Math.round(weights.d30_weight * 100);
      const d365WeightPct = Math.round(weights.d365_weight * 100);
      const lifetimeWeightPct = Math.round(weights.lifetime_weight * 100);

      // Create keyword recommendations sheet
      const keywordData = (strategyData.recommendations || []).map((rec: any) => {
        const timeframesUsed: string[] = [];
        if (rec.t0_acos !== null) timeframesUsed.push('T0');
        if (rec.d30_acos !== null) timeframesUsed.push('30D');
        if (rec.d365_acos !== null) timeframesUsed.push('365D');
        if (rec.lifetime_acos !== null) timeframesUsed.push('Lifetime');
        
        return {
          'Recommendation Type': 'Keyword Bid',
          'Country': rec.country,
          'Campaign Name': rec.campaign_name,
          'Ad Group Name': rec.ad_group_name,
          'Targeting': rec.targeting,
          'Match Type': rec.match_type,
          'Current Bid': rec.current_bid,
          'Recommended Bid': rec.recommended_bid,
          'Change %': `${rec.change_percent}%`,
          'Action': rec.action,
          'ACOS Target': `${rec.acos_target_percent}%`,
          'Weighted ACOS': `${rec.weighted_acos_percent}%`,
          'T0 ACOS': rec.t0_acos ? `${Math.round(rec.t0_acos * 100)}%` : 'N/A',
          '30D ACOS': rec.d30_acos ? `${Math.round(rec.d30_acos * 100)}%` : 'N/A',
          '365D ACOS': rec.d365_acos ? `${Math.round(rec.d365_acos * 100)}%` : 'N/A',
          'Lifetime ACOS': rec.lifetime_acos ? `${Math.round(rec.lifetime_acos * 100)}%` : 'N/A',
          'Confidence': rec.confidence,
          'Days Since Change': rec.days_since_change,
          'Has Placement Recs': rec.hasPlacementRecs ? 'YES' : 'No'
        };
      });

      if (keywordData.length > 0) {
        const wsKeywords = XLSX.utils.json_to_sheet(keywordData);
        XLSX.utils.book_append_sheet(wb, wsKeywords, 'Keyword Recommendations');
      }

      // Fetch placement recommendations for campaigns with keyword recs
      const campaignIds = campaignId 
        ? [campaignId as string]
        : Array.from(new Set(strategyData.recommendations?.map((r: any) => r.campaign_id) || []));

      const allPlacements: any[] = [];
      for (const cId of campaignIds.slice(0, 50)) { // Limit to 50 campaigns
        try {
          const placementsResponse = await fetch(`${protocol}://${host}/api/campaign-placements?campaignId=${cId}&country=${country}`);
          const placementsData = await placementsResponse.json();
          
          if (placementsData.placements?.length > 0) {
            // Find campaign name from keyword data
            const campaignName = strategyData.recommendations?.find((r: any) => r.campaign_id === cId)?.campaign_name || cId;
            
            for (const p of placementsData.placements) {
              if (p.targetBidAdjustment !== null && p.targetBidAdjustment !== p.bidAdjustment) {
                allPlacements.push({
                  'Recommendation Type': 'Placement Adjustment',
                  'Country': country,
                  'Campaign ID': cId,
                  'Campaign Name': campaignName,
                  'Placement': p.placement,
                  'Bidding Strategy': p.biddingStrategy || 'N/A',
                  'Current Bid Adjustment': p.bidAdjustment !== null ? `${p.bidAdjustment}%` : 'Not set',
                  'Recommended Bid Adjustment': p.targetBidAdjustment !== null ? `${p.targetBidAdjustment}%` : 'N/A',
                  'Change': p.targetBidAdjustment !== null && p.bidAdjustment !== null 
                    ? `${p.targetBidAdjustment - p.bidAdjustment > 0 ? '+' : ''}${p.targetBidAdjustment - p.bidAdjustment}%`
                    : 'N/A',
                  'Clicks': p.clicks,
                  'ACOS': p.acos ? `${p.acos.toFixed(1)}%` : 'N/A',
                  'Spend (EUR)': p.spend?.toFixed(2) || '0.00',
                  'Sales (EUR)': p.sales?.toFixed(2) || '0.00',
                  'Has Keyword Recs': 'YES'
                });
              }
            }
          }
        } catch (placementError) {
          console.warn(`Could not fetch placements for campaign ${cId}:`, placementError);
        }
      }

      if (allPlacements.length > 0) {
        const wsPlacements = XLSX.utils.json_to_sheet(allPlacements);
        XLSX.utils.book_append_sheet(wb, wsPlacements, 'Placement Adjustments');
      }

      // Add metadata sheet
      const metadataData = [{
        'Export Date': new Date().toISOString().split('T')[0],
        'Country': country,
        'T0 Weight (Since Last Bid Change)': `${t0WeightPct}%`,
        '30D Weight': `${d30WeightPct}%`,
        '365D Weight': `${d365WeightPct}%`,
        'Lifetime Weight': `${lifetimeWeightPct}%`,
        'Total Keyword Recommendations': keywordData.length,
        'Total Placement Adjustments': allPlacements.length,
        'Campaigns with Both Adjustments': Array.from(new Set(allPlacements.map(p => p['Campaign ID']))).length,
        'Note': 'Recommendations are generated daily at 3:00 AM UTC'
      }];
      const wsMetadata = XLSX.utils.json_to_sheet(metadataData);
      XLSX.utils.book_append_sheet(wb, wsMetadata, 'Export Metadata');

      // Add sheet for campaigns needing both adjustments
      const campaignsWithBoth = keywordData.filter((k: any) => k['Has Placement Recs'] === 'YES');
      if (campaignsWithBoth.length > 0) {
        const wsBoth = XLSX.utils.json_to_sheet(campaignsWithBoth);
        XLSX.utils.book_append_sheet(wb, wsBoth, 'Needs Both Adjustments');
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="combined-recommendations-${country}-${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('Combined export error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Health check endpoint to verify database connectivity
  app.get("/api/health", async (req, res) => {
    try {
      // Test database connection by running a simple query
      await db.execute(sql`SELECT 1 as test`);
      
      // Also verify our tables exist
      const tableCheck = await db.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('s_products_search_terms', 's_brand_search_terms', 's_display_matched_target')
      `);
      
      const tables = Array.isArray(tableCheck) ? tableCheck.map((row: any) => row.table_name) : [];
      
      res.json({ 
        status: 'ok',
        database: 'connected',
        tables: tables,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Health check failed:', error);
      res.status(500).json({ 
        status: 'error',
        database: 'disconnected',
        error: error.message || 'Unknown database error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ─── Amazon Ads API routes ─────────────────────────────────────────────────

  // Health check: verify Amazon Ads credentials are valid
  app.get("/api/amazon-ads/health", async (req, res) => {
    const { getAmazonAdsClient } = await import('./amazonAdsClient');
    const client = getAmazonAdsClient();
    if (!client) {
      return res.json({ ok: false, error: 'Amazon Ads credentials not configured' });
    }
    const result = await client.healthCheck();
    res.json(result);
  });

  // List available advertiser profiles (useful for finding your profile ID)
  app.get("/api/amazon-ads/profiles", async (req, res) => {
    const { getAmazonAdsClient } = await import('./amazonAdsClient');
    const client = getAmazonAdsClient();
    if (!client) {
      return res.status(400).json({ error: 'Amazon Ads credentials not configured' });
    }
    try {
      const profiles = await client.listProfiles();
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual sync trigger: pull reports from Amazon Ads API into Supabase
  app.post("/api/amazon-ads/sync", async (req, res) => {
    const { syncAmazonAdsData } = await import('./utils/amazonAdsSync');
    const { startDate, endDate, country } = req.body || {};
    try {
      const result = await syncAmazonAdsData(startDate, endDate, country);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
