import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { brandSearchTerms, brandPlacement, productSearchTerms, productPlacement, displayMatchedTarget, displayTargeting, recommendations } from "@shared/schema";
import { sql, eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { calculateACOS, calculateCPC, calculateCVR, calculateROAS, getConfidenceLevel } from "./utils/calculations";
import { generateBidRecommendation, detectNegativeKeywords } from "./utils/recommendations";
import { getExchangeRatesForDate, convertToEur } from "./utils/exchangeRates";
import * as XLSX from 'xlsx';

export async function registerRoutes(app: Express): Promise<Server> {
  
  // KPI aggregation endpoint - filters by campaign type
  app.get("/api/kpis", async (req, res) => {
    try {
      const { country, campaignId, adGroupId, campaignType = 'products', from, to } = req.query;
      
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
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.date, productSearchTerms.campaignBudgetCurrencyCode);
      }

      // Get unique dates for exchange rate fetching
      const uniqueDates = new Set<string>();
      results.forEach(row => row.date && uniqueDates.add(row.date));

      // Fetch exchange rates for each unique date
      const exchangeRatesCache = new Map<string, Record<string, number>>();
      for (const date of Array.from(uniqueDates)) {
        const rates = await getExchangeRatesForDate(date);
        exchangeRatesCache.set(date, rates);
      }

      // Convert to EUR and aggregate
      let totalClicks = 0;
      let totalCostEur = 0;
      let totalSalesEur = 0;
      let totalOrders = 0;

      results.forEach(row => {
        if (!row.date) return;
        
        const rates = exchangeRatesCache.get(row.date) || {};
        const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
        const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);

        totalClicks += Number(row.clicks);
        totalCostEur += costEur;
        totalSalesEur += salesEur;
        totalOrders += Number(row.orders);
      });

      const acos = calculateACOS(totalCostEur, totalSalesEur);
      const cpc = calculateCPC(totalCostEur, totalClicks);
      const roas = calculateROAS(totalSalesEur, totalCostEur);

      res.json({
        adSales: totalSalesEur,
        acos,
        cpc,
        cost: totalCostEur,
        roas,
        orders: totalOrders,
        clicks: totalClicks,
        currency: 'EUR',
      });
    } catch (error) {
      console.error('KPI error:', error);
      res.status(500).json({ error: 'Failed to fetch KPIs' });
    }
  });

  // Countries list endpoint - combines brand + product with EUR conversion
  app.get("/api/countries", async (req, res) => {
    try {
      const { from, to } = req.query;
      
      // Query brand data grouped by country, date, and currency
      const brandConditions = [];
      if (from) brandConditions.push(gte(brandSearchTerms.date, from as string));
      if (to) brandConditions.push(lte(brandSearchTerms.date, to as string));

      const brandResults = await db
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
        .where(brandConditions.length > 0 ? and(...brandConditions) : undefined)
        .groupBy(brandSearchTerms.country, brandSearchTerms.date, brandSearchTerms.campaignBudgetCurrencyCode);

      // Query product data grouped by country, date, and currency
      const productConditions = [];
      if (from) productConditions.push(gte(productSearchTerms.date, from as string));
      if (to) productConditions.push(lte(productSearchTerms.date, to as string));

      const productResults = await db
        .select({
          country: productSearchTerms.country,
          date: productSearchTerms.date,
          currency: productSearchTerms.campaignBudgetCurrencyCode,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(productConditions.length > 0 ? and(...productConditions) : undefined)
        .groupBy(productSearchTerms.country, productSearchTerms.date, productSearchTerms.campaignBudgetCurrencyCode);

      // Get unique dates for exchange rate fetching
      const uniqueDates = new Set<string>();
      brandResults.forEach(row => row.date && uniqueDates.add(row.date));
      productResults.forEach(row => row.date && uniqueDates.add(row.date));

      // Fetch exchange rates for each unique date
      const exchangeRatesCache = new Map<string, Record<string, number>>();
      for (const date of Array.from(uniqueDates)) {
        const rates = await getExchangeRatesForDate(date);
        exchangeRatesCache.set(date, rates);
      }

      // Combine and convert to EUR
      const countryMap = new Map<string, {
        country: string;
        clicks: number;
        costEur: number;
        salesEur: number;
        orders: number;
      }>();

      // Process brand results
      brandResults.forEach(row => {
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

      // Process product results
      productResults.forEach(row => {
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

      res.json(countries);
    } catch (error) {
      console.error('Countries error:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // Campaigns by country endpoint - combines brand + product
  app.get("/api/campaigns", async (req, res) => {
    try {
      const { country, from, to } = req.query;
      
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
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
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

      res.json(campaigns);
    } catch (error) {
      console.error('Campaigns error:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // Ad groups by campaign endpoint - combines brand + product
  app.get("/api/ad-groups", async (req, res) => {
    try {
      const { campaignId, from, to } = req.query;
      
      // Query brand ad groups
      const brandConditions = [];
      if (campaignId) brandConditions.push(sql`${brandSearchTerms.campaignId}::text = ${campaignId}`);
      if (from) brandConditions.push(gte(brandSearchTerms.date, from as string));
      if (to) brandConditions.push(lte(brandSearchTerms.date, to as string));

      const brandResults = await db
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
        .where(brandConditions.length > 0 ? and(...brandConditions) : undefined)
        .groupBy(brandSearchTerms.adGroupId);

      // Query product ad groups
      const productConditions = [];
      if (campaignId) productConditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
      if (from) productConditions.push(gte(productSearchTerms.date, from as string));
      if (to) productConditions.push(lte(productSearchTerms.date, to as string));

      const productResults = await db
        .select({
          adGroupId: productSearchTerms.adGroupId,
          adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
          currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
        })
        .from(productSearchTerms)
        .where(productConditions.length > 0 ? and(...productConditions) : undefined)
        .groupBy(productSearchTerms.adGroupId);

      // Combine by ad group ID
      const adGroupMap = new Map();
      
      brandResults.forEach(row => {
        if (row.adGroupId) {
          adGroupMap.set(String(row.adGroupId), {
            id: row.adGroupId,
            adGroup: row.adGroupName,
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            orders: Number(row.orders),
            currency: row.currency,
          });
        }
      });

      productResults.forEach(row => {
        if (row.adGroupId) {
          const key = String(row.adGroupId);
          const existing = adGroupMap.get(key);
          if (existing) {
            existing.clicks += Number(row.clicks);
            existing.cost += Number(row.cost);
            existing.sales += Number(row.sales);
            existing.orders += Number(row.orders);
          } else {
            adGroupMap.set(key, {
              id: row.adGroupId,
              adGroup: row.adGroupName,
              clicks: Number(row.clicks),
              cost: Number(row.cost),
              sales: Number(row.sales),
              orders: Number(row.orders),
              currency: row.currency,
            });
          }
        }
      });

      const adGroups = Array.from(adGroupMap.values())
        .map(row => ({
          ...row,
          acos: calculateACOS(row.cost, row.sales),
        }))
        .sort((a, b) => b.sales - a.sales);

      res.json(adGroups);
    } catch (error) {
      console.error('Ad groups error:', error);
      res.status(500).json({ error: 'Failed to fetch ad groups' });
    }
  });

  // Search terms by ad group endpoint - filters by campaign type
  app.get("/api/search-terms", async (req, res) => {
    try {
      const { adGroupId, campaignType = 'products', from, to } = req.query;
      
      let results: Array<{
        searchTerm: string | null;
        keyword: string | null;
        matchType: string | null;
        keywordBid: number;
        clicks: number;
        cost: number;
        sales: number;
        orders: number;
        currency: string | null;
      }> = [];

      if (campaignType === 'brands') {
        // Query brand search terms only (brand tables don't use adGroupId)
        const conditions = [];
        if (from) conditions.push(gte(brandSearchTerms.date, from as string));
        if (to) conditions.push(lte(brandSearchTerms.date, to as string));

        results = await db
          .select({
            searchTerm: brandSearchTerms.searchTerm,
            keyword: sql<string>`MAX(${brandSearchTerms.keywordText})`,
            matchType: sql<string>`MAX(${brandSearchTerms.matchType})`,
            keywordBid: sql<number>`MAX(${brandSearchTerms.keywordBid})`,
            clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
            currency: sql<string>`MAX(${brandSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(brandSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(brandSearchTerms.searchTerm);
      } else if (campaignType === 'display') {
        // Query display matched target (equivalent to search terms for display, no adGroupId filter)
        const conditions = [];
        if (from) conditions.push(gte(displayMatchedTarget.date, from as string));
        if (to) conditions.push(lte(displayMatchedTarget.date, to as string));

        const displayResults = await db
          .select({
            targetingText: displayMatchedTarget.targetingText,
            matchedAsin: sql<string>`MAX(${displayMatchedTarget.matchedTargetAsin})`,
            clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
            orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
            currency: sql<string>`MAX(${displayMatchedTarget.campaignBudgetCurrencyCode})`,
          })
          .from(displayMatchedTarget)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(displayMatchedTarget.targetingText);

        // Map display results to match the search terms structure
        results = displayResults.map(row => ({
          searchTerm: row.targetingText,
          keyword: row.matchedAsin,
          matchType: 'Display',
          keywordBid: 0, // Display doesn't have keyword bids like search
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
          orders: Number(row.orders),
          currency: row.currency,
        }));
      } else {
        // Default: Query product search terms only
        const conditions = [];
        if (adGroupId) conditions.push(sql`${productSearchTerms.adGroupId}::text = ${adGroupId}`);
        if (from) conditions.push(gte(productSearchTerms.date, from as string));
        if (to) conditions.push(lte(productSearchTerms.date, to as string));

        results = await db
          .select({
            searchTerm: productSearchTerms.searchTerm,
            keyword: sql<string>`MAX(${productSearchTerms.keyword})`,
            matchType: sql<string>`MAX(${productSearchTerms.matchType})`,
            keywordBid: sql<number>`MAX(${productSearchTerms.keywordBid})`,
            clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
            cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
            orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
            currency: sql<string>`MAX(${productSearchTerms.campaignBudgetCurrencyCode})`,
          })
          .from(productSearchTerms)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productSearchTerms.searchTerm);
      }

      const searchTerms = results
        .filter(row => row.searchTerm)
        .map(row => {
          const acos = calculateACOS(row.cost, row.sales);
          const cpc = calculateCPC(row.cost, row.clicks);
          const targetAcos = 20;
          
          // Calculate recommendation for ALL terms (not just 30+ clicks)
          const baseBid = row.keywordBid || cpc || 1.0;
          let recommendedBid = baseBid;
          let confidence = getConfidenceLevel(row.clicks).label;
          
          // Apply PPC AI logic for all terms with any data
          if (row.clicks > 0) {
            if (row.sales === 0 && row.clicks >= 20) {
              // No sales with significant clicks - reduce bid
              recommendedBid = baseBid * 0.85; // -15%
            } else if (acos > 0 && acos <= targetAcos * 0.8) {
              // ACOS well below target - increase bid
              const increase = row.clicks >= 100 ? 1.15 : 1.10;
              recommendedBid = baseBid * increase;
            } else if (acos > 0) {
              // Standard formula: current bid × (target ACOS / current ACOS)
              recommendedBid = baseBid * (targetAcos / acos);
            }
            
            // Apply safeguards: 20% to 150% of base bid
            const minBid = baseBid * 0.20;
            const maxBid = baseBid * 1.50;
            recommendedBid = Math.max(minBid, Math.min(maxBid, recommendedBid));
            recommendedBid = Math.round(recommendedBid * 100) / 100;
          }
          
          const bidChange = baseBid > 0 ? ((recommendedBid - baseBid) / baseBid) * 100 : 0;

          return {
            searchTerm: row.searchTerm,
            keyword: row.keyword,
            matchType: row.matchType,
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            orders: Number(row.orders),
            acos,
            cpc,
            cvr: Number(row.clicks) > 0 ? (Number(row.orders) / Number(row.clicks)) * 100 : 0,
            currentBid: Number(row.keywordBid || 0),
            recommendedBid: Number(recommendedBid),
            bidChange: Number(bidChange),
            confidence: confidence,
            currency: row.currency,
          };
        })
        .sort((a, b) => b.clicks - a.clicks);

      res.json(searchTerms);
    } catch (error) {
      console.error('Search terms error:', error);
      res.status(500).json({ error: 'Failed to fetch search terms' });
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
            placement: productPlacement.campaignPlacement,
            clicks: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.clicks}, '')::numeric), 0)`,
            cost: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.cost}, '')::numeric), 0)`,
            sales: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.sales7d}, '')::numeric), 0)`,
            purchases: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.purchases7d}, '')::numeric), 0)`,
          })
          .from(productPlacement)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .groupBy(productPlacement.campaignPlacement);
      }

      const placements = results
        .filter(row => row.placement)
        .map(row => ({
          placement: row.placement || 'UNKNOWN',
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
      const targetAcos = 20; // 20% target ACOS
      
      // Query ALL placement data for the campaign in one go (not aggregated yet)
      const conditions: any[] = [];
      if (campaignId) conditions.push(sql`${productPlacement.campaignId}::text = ${campaignId}`);
      if (from) conditions.push(gte(productPlacement.date, from as string));
      if (to) conditions.push(lte(productPlacement.date, to as string));

      const allResults = await db
        .select({
          placement: productPlacement.campaignPlacement,
          biddingStrategy: productPlacement.campaignBiddingStrategy,
          date: productPlacement.date,
          country: productPlacement.country,
          impressions: sql<string>`NULLIF(${productPlacement.impressions}, '')`,
          clicks: sql<string>`NULLIF(${productPlacement.clicks}, '')`,
          cost: sql<string>`NULLIF(${productPlacement.cost}, '')`,
          sales: sql<string>`NULLIF(${productPlacement.sales7d}, '')`,
          purchases: sql<string>`NULLIF(${productPlacement.purchases7d}, '')`,
        })
        .from(productPlacement)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // Get unique dates for exchange rates (fetch all at once)
      const uniqueDates = Array.from(new Set(allResults.map(r => r.date).filter(d => d !== null))) as string[];
      const exchangeRatesMap = new Map();
      for (const date of uniqueDates) {
        const rates = await getExchangeRatesForDate(date);
        exchangeRatesMap.set(date, rates);
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
        const rates = exchangeRatesMap.get(row.date) || {};
        const country = row.country as string;

        // Convert to EUR and aggregate
        const impressions = Number(row.impressions || 0);
        const clicks = Number(row.clicks || 0);
        const cost = Number(row.cost || 0);
        const sales = Number(row.sales || 0);
        const orders = Number(row.purchases || 0);

        const costEur = convertToEur(cost, country, rates);
        const salesEur = convertToEur(sales, country, rates);

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
        
        // Calculate recommended bid adjustment based on ACOS
        let recommendedBidAdjustment = 0;
        
        if (group.totalClicks >= 30 && group.totalSalesEur > 0) {
          if (acos <= targetAcos * 0.8) {
            // ACOS well below target (≤16%), increase bid adjustment
            if (group.totalClicks >= 1000) {
              recommendedBidAdjustment = 20; // +20%
            } else if (group.totalClicks >= 300) {
              recommendedBidAdjustment = 15; // +15%
            } else {
              recommendedBidAdjustment = 10; // +10%
            }
          } else if (acos > targetAcos) {
            // ACOS above target, decrease bid adjustment using formula
            const targetAdjustment = (targetAcos / acos - 1) * 100;
            recommendedBidAdjustment = Math.max(-50, Math.min(0, targetAdjustment)); // Cap at -50%
          } else {
            // ACOS near target, small adjustment
            recommendedBidAdjustment = (targetAcos / acos - 1) * 100;
            recommendedBidAdjustment = Math.max(-10, Math.min(10, recommendedBidAdjustment));
          }
        } else if (group.totalClicks >= 30 && group.totalSalesEur === 0) {
          // No sales, recommend decreasing bid
          recommendedBidAdjustment = -25; // -25%
        }
        
        // Round to nearest integer
        recommendedBidAdjustment = Math.round(recommendedBidAdjustment);

        return {
          placement: group.placement,
          biddingStrategy: group.biddingStrategy,
          bidAdjustment: null, // Current bid adjustment from Amazon (not in our data yet)
          impressions: group.totalImpressions,
          clicks: group.totalClicks,
          ctr,
          spend: group.totalCostEur,
          cpc,
          orders: group.totalOrders,
          sales: group.totalSalesEur,
          acos,
          cvr,
          recommendedBidAdjustment,
        };
      });

      // Sort by placement priority: TOS > ROS > PP > UNKNOWN
      const placementOrder = { 'Top of search (first page)': 1, 'Rest of search': 2, 'Product pages': 3, 'UNKNOWN': 4 };
      placements.sort((a, b) => {
        const orderA = placementOrder[a.placement as keyof typeof placementOrder] || 999;
        const orderB = placementOrder[b.placement as keyof typeof placementOrder] || 999;
        return orderA - orderB;
      });

      res.json(placements);
    } catch (error) {
      console.error('Campaign placements error:', error);
      res.status(500).json({ error: 'Failed to fetch campaign placements' });
    }
  });

  // Chart data endpoint with aggregation - combines brand + product
  app.get("/api/chart-data", async (req, res) => {
    try {
      const { country, campaignId, from, to, groupBy = 'daily' } = req.query;
      
      // Build brand conditions
      const brandConditions = [];
      if (country) brandConditions.push(eq(brandSearchTerms.country, country as string));
      if (campaignId) brandConditions.push(sql`${brandSearchTerms.campaignId}::text = ${campaignId}`);
      if (from) brandConditions.push(gte(brandSearchTerms.date, from as string));
      if (to) brandConditions.push(lte(brandSearchTerms.date, to as string));

      // Build product conditions
      const productConditions = [];
      if (country) productConditions.push(eq(productSearchTerms.country, country as string));
      if (campaignId) productConditions.push(sql`${productSearchTerms.campaignId}::text = ${campaignId}`);
      if (from) productConditions.push(gte(productSearchTerms.date, from as string));
      if (to) productConditions.push(lte(productSearchTerms.date, to as string));

      // Determine date grouping
      let dateGroup;
      if (groupBy === 'weekly') {
        dateGroup = sql`DATE_TRUNC('week', ${brandSearchTerms.date})`;
      } else if (groupBy === 'monthly') {
        dateGroup = sql`DATE_TRUNC('month', ${brandSearchTerms.date})`;
      } else {
        dateGroup = brandSearchTerms.date; // daily (already in date format)
      }

      // Query brand data
      const brandResults = await db
        .select({
          date: sql<string>`${dateGroup}::text`,
          cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
        })
        .from(brandSearchTerms)
        .where(brandConditions.length > 0 ? and(...brandConditions) : undefined)
        .groupBy(sql`${dateGroup}`)
        .orderBy(asc(sql`${dateGroup}`));

      // Query product data
      let productDateGroup;
      if (groupBy === 'weekly') {
        productDateGroup = sql`DATE_TRUNC('week', ${productSearchTerms.date}::date)`;
      } else if (groupBy === 'monthly') {
        productDateGroup = sql`DATE_TRUNC('month', ${productSearchTerms.date}::date)`;
      } else {
        productDateGroup = sql`${productSearchTerms.date}::date`;
      }

      const productResults = await db
        .select({
          date: sql<string>`${productDateGroup}::text`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(productConditions.length > 0 ? and(...productConditions) : undefined)
        .groupBy(sql`${productDateGroup}`)
        .orderBy(asc(sql`${productDateGroup}`));

      // Combine by date
      const dateMap = new Map();
      
      brandResults.forEach(row => {
        const date = row.date.split('T')[0]; // Extract date part
        dateMap.set(date, {
          date,
          cost: Number(row.cost),
          sales: Number(row.sales),
        });
      });

      productResults.forEach(row => {
        const date = row.date.split('T')[0]; // Extract date part
        const existing = dateMap.get(date);
        if (existing) {
          existing.cost += Number(row.cost);
          existing.sales += Number(row.sales);
        } else {
          dateMap.set(date, {
            date,
            cost: Number(row.cost),
            sales: Number(row.sales),
          });
        }
      });

      const chartData = Array.from(dateMap.values())
        .map(row => ({
          date: row.date,
          acos: calculateACOS(row.cost, row.sales),
          sales: row.sales,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json(chartData);
    } catch (error) {
      console.error('Chart data error:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
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
          searchTerm: productSearchTerms.searchTerm,
          campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
          adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(productSearchTerms.searchTerm);

      const negatives = detectNegativeKeywords(
        results.map(row => ({
          searchTerm: row.searchTerm || '',
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
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
          searchTerm: productSearchTerms.searchTerm,
          campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
          adGroupName: sql<string>`MAX(${productSearchTerms.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
        })
        .from(productSearchTerms)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(productSearchTerms.searchTerm);

      const negatives = detectNegativeKeywords(
        results.map(row => ({
          searchTerm: row.searchTerm || '',
          clicks: Number(row.clicks),
          cost: Number(row.cost),
          sales: Number(row.sales),
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

  // Generate bid recommendations endpoint
  app.post("/api/recommendations/generate", async (req, res) => {
    try {
      const { scope, scopeId, from, to, targetAcos = 20 } = req.body;

      if (!scopeId) {
        return res.status(400).json({ error: 'Missing required parameters' });
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
          sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales7d}, '')::numeric), 0)`,
          orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases7d}, '')::numeric), 0)`,
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
          else if (term.sales > 0 && acos > 0) {
            proposedBid = baseBid * (targetAcos / acos);
            
            if (acos > targetAcos * 1.1) {
              rationale = `ACOS ${acos.toFixed(1)}% exceeds target ${targetAcos}%. Applying formula: ${baseBid.toFixed(2)} × (${targetAcos} / ${acos.toFixed(1)}) = ${proposedBid.toFixed(2)}. CVR: ${cvr.toFixed(1)}%`;
            } else if (acos < targetAcos * 0.9) {
              rationale = `ACOS ${acos.toFixed(1)}% below target ${targetAcos}%. Optimizing bid for growth. CVR: ${cvr.toFixed(1)}%`;
            } else {
              rationale = `ACOS ${acos.toFixed(1)}% near target ${targetAcos}%. Fine-tuning bid. CVR: ${cvr.toFixed(1)}%`;
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

  const httpServer = createServer(app);
  return httpServer;
}
