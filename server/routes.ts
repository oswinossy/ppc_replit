import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { searchTermsDaily, placementsDaily, recommendations } from "@shared/schema";
import { sql, eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { calculateACOS, calculateCPC, calculateCVR, calculateROAS } from "./utils/calculations";
import { generateBidRecommendation, detectNegativeKeywords } from "./utils/recommendations";
import * as XLSX from 'xlsx';

export async function registerRoutes(app: Express): Promise<Server> {
  
  // KPI aggregation endpoint
  app.get("/api/kpis", async (req, res) => {
    try {
      const { country, campaignId, adGroupId, from, to } = req.query;
      
      const conditions = [];
      if (country) conditions.push(eq(searchTermsDaily.country, country as string));
      if (campaignId) conditions.push(eq(searchTermsDaily.campaignId, campaignId as string));
      if (adGroupId) conditions.push(eq(searchTermsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const result = await db
        .select({
          totalClicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          totalSales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          totalOrders: sql<number>`COALESCE(SUM(${searchTermsDaily.purchases7d}), 0)`,
          currency: sql<string>`MAX(${searchTermsDaily.currency})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const data = result[0];
      const acos = calculateACOS(Number(data.totalCost), Number(data.totalSales));
      const cpc = calculateCPC(Number(data.totalCost), Number(data.totalClicks));
      const roas = calculateROAS(Number(data.totalSales), Number(data.totalCost));

      res.json({
        adSales: Number(data.totalSales),
        acos,
        cpc,
        cost: Number(data.totalCost),
        roas,
        orders: Number(data.totalOrders),
        clicks: Number(data.totalClicks),
        currency: data.currency || 'EUR',
      });
    } catch (error) {
      console.error('KPI error:', error);
      res.status(500).json({ error: 'Failed to fetch KPIs' });
    }
  });

  // Countries list endpoint
  app.get("/api/countries", async (req, res) => {
    try {
      const { from, to } = req.query;
      
      const conditions = [];
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          country: searchTermsDaily.country,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          orders: sql<number>`COALESCE(SUM(${searchTermsDaily.purchases7d}), 0)`,
          currency: sql<string>`MAX(${searchTermsDaily.currency})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(searchTermsDaily.country)
        .orderBy(desc(sql`SUM(${searchTermsDaily.sales7d})`));

      const countries = results.map(row => ({
        country: row.country,
        code: row.country,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        orders: Number(row.orders),
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
        currency: row.currency,
      }));

      res.json(countries);
    } catch (error) {
      console.error('Countries error:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // Campaigns by country endpoint
  app.get("/api/campaigns", async (req, res) => {
    try {
      const { country, from, to } = req.query;
      
      const conditions = [];
      if (country) conditions.push(eq(searchTermsDaily.country, country as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          campaignId: searchTermsDaily.campaignId,
          campaignName: sql<string>`MAX(${searchTermsDaily.campaignName})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          orders: sql<number>`COALESCE(SUM(${searchTermsDaily.purchases7d}), 0)`,
          currency: sql<string>`MAX(${searchTermsDaily.currency})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(searchTermsDaily.campaignId)
        .orderBy(desc(sql`SUM(${searchTermsDaily.sales7d})`));

      const campaigns = results.map(row => ({
        id: row.campaignId,
        campaign: row.campaignName,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        orders: Number(row.orders),
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
        currency: row.currency,
      }));

      res.json(campaigns);
    } catch (error) {
      console.error('Campaigns error:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // Ad groups by campaign endpoint
  app.get("/api/ad-groups", async (req, res) => {
    try {
      const { campaignId, from, to } = req.query;
      
      const conditions = [];
      if (campaignId) conditions.push(eq(searchTermsDaily.campaignId, campaignId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          adGroupId: searchTermsDaily.adGroupId,
          adGroupName: sql<string>`MAX(${searchTermsDaily.adGroupName})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          orders: sql<number>`COALESCE(SUM(${searchTermsDaily.purchases7d}), 0)`,
          currency: sql<string>`MAX(${searchTermsDaily.currency})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(searchTermsDaily.adGroupId)
        .orderBy(desc(sql`SUM(${searchTermsDaily.sales7d})`));

      const adGroups = results.map(row => ({
        id: row.adGroupId,
        adGroup: row.adGroupName,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        orders: Number(row.orders),
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
        currency: row.currency,
      }));

      res.json(adGroups);
    } catch (error) {
      console.error('Ad groups error:', error);
      res.status(500).json({ error: 'Failed to fetch ad groups' });
    }
  });

  // Search terms by ad group endpoint
  app.get("/api/search-terms", async (req, res) => {
    try {
      const { adGroupId, from, to } = req.query;
      
      const conditions = [];
      if (adGroupId) conditions.push(eq(searchTermsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          searchTerm: sql<string>`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`,
          matchType: sql<string>`MAX(${searchTermsDaily.matchType})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          orders: sql<number>`COALESCE(SUM(${searchTermsDaily.purchases7d}), 0)`,
          currentBid: sql<number>`MAX(${searchTermsDaily.keywordBid})`,
          currency: sql<string>`MAX(${searchTermsDaily.currency})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`)
        .orderBy(desc(sql`SUM(${searchTermsDaily.sales7d})`));

      const searchTerms = results.map(row => ({
        searchTerm: row.searchTerm,
        matchType: row.matchType,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        orders: Number(row.orders),
        cpc: calculateCPC(Number(row.cost), Number(row.clicks)),
        cvr: calculateCVR(Number(row.orders), Number(row.clicks)),
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
        currentBid: Number(row.currentBid),
        currency: row.currency,
      }));

      res.json(searchTerms);
    } catch (error) {
      console.error('Search terms error:', error);
      res.status(500).json({ error: 'Failed to fetch search terms' });
    }
  });

  // Placements by ad group endpoint
  app.get("/api/placements", async (req, res) => {
    try {
      const { adGroupId, from, to } = req.query;
      
      const conditions = [];
      if (adGroupId) conditions.push(eq(placementsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(placementsDaily.dt, from as string));
      if (to) conditions.push(lte(placementsDaily.dt, to as string));

      const results = await db
        .select({
          placement: placementsDaily.placement,
          clicks: sql<number>`COALESCE(SUM(${placementsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${placementsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${placementsDaily.sales}), 0)`,
        })
        .from(placementsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(placementsDaily.placement)
        .orderBy(desc(sql`SUM(${placementsDaily.sales})`));

      const placements = results.map(row => ({
        placement: row.placement,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
      }));

      res.json(placements);
    } catch (error) {
      console.error('Placements error:', error);
      res.status(500).json({ error: 'Failed to fetch placements' });
    }
  });

  // Chart data endpoint with aggregation
  app.get("/api/chart-data", async (req, res) => {
    try {
      const { country, campaignId, adGroupId, from, to, grain = 'daily' } = req.query;
      
      const conditions = [];
      if (country) conditions.push(eq(searchTermsDaily.country, country as string));
      if (campaignId) conditions.push(eq(searchTermsDaily.campaignId, campaignId as string));
      if (adGroupId) conditions.push(eq(searchTermsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      let dateGroup;
      if (grain === 'weekly') {
        dateGroup = sql<string>`DATE_TRUNC('week', ${searchTermsDaily.dt})`;
      } else if (grain === 'monthly') {
        dateGroup = sql<string>`DATE_TRUNC('month', ${searchTermsDaily.dt})`;
      } else {
        dateGroup = searchTermsDaily.dt;
      }

      const results = await db
        .select({
          date: dateGroup,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(dateGroup)
        .orderBy(asc(dateGroup));

      const chartData = results.map(row => ({
        date: new Date(row.date as string).toISOString().split('T')[0],
        acos: calculateACOS(Number(row.cost), Number(row.sales)),
        sales: Number(row.sales),
      }));

      res.json(chartData);
    } catch (error) {
      console.error('Chart data error:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
    }
  });

  // Generate recommendations endpoint
  app.post("/api/recommendations/generate", async (req, res) => {
    try {
      const { scope, scopeId, from, to, targetAcos = 20 } = req.body;
      
      const conditions = [];
      if (scope === 'country' && scopeId) conditions.push(eq(searchTermsDaily.country, scopeId));
      if (scope === 'campaign' && scopeId) conditions.push(eq(searchTermsDaily.campaignId, scopeId));
      if (scope === 'ad_group' && scopeId) conditions.push(eq(searchTermsDaily.adGroupId, scopeId));
      if (from) conditions.push(gte(searchTermsDaily.dt, from));
      if (to) conditions.push(lte(searchTermsDaily.dt, to));

      // Get search terms data
      const results = await db
        .select({
          searchTerm: sql<string>`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          currentBid: sql<number>`MAX(${searchTermsDaily.keywordBid})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`);

      // Calculate median CPC for the ad group
      const costs = results.map(r => Number(r.cost));
      const clicks = results.map(r => Number(r.clicks));
      const totalCost = costs.reduce((sum, c) => sum + c, 0);
      const totalClicks = clicks.reduce((sum, c) => sum + c, 0);
      const adGroupMedianCPC = totalClicks > 0 ? totalCost / totalClicks : 1.0;

      // Generate recommendations
      const recommendations = results
        .map(row => generateBidRecommendation(
          {
            searchTerm: row.searchTerm,
            clicks: Number(row.clicks),
            cost: Number(row.cost),
            sales: Number(row.sales),
            currentBid: row.currentBid ? Number(row.currentBid) : null,
            cpc: Number(row.clicks) > 0 ? Number(row.cost) / Number(row.clicks) : 0,
          },
          targetAcos,
          adGroupMedianCPC
        ))
        .filter(rec => rec !== null);

      // Save to database
      await db.insert(recommendations as any).values({
        scope,
        scopeId: scopeId || null,
        generatedFor: `${from}-${to}`,
        targetAcos: targetAcos.toString(),
        items: JSON.stringify(recommendations),
      });

      res.json({ recommendations, count: recommendations.length });
    } catch (error) {
      console.error('Recommendations error:', error);
      res.status(500).json({ error: 'Failed to generate recommendations' });
    }
  });

  // Negative keywords endpoint
  app.get("/api/negative-keywords", async (req, res) => {
    try {
      const { country, campaignId, adGroupId, from, to } = req.query;
      
      const conditions = [];
      if (country) conditions.push(eq(searchTermsDaily.country, country as string));
      if (campaignId) conditions.push(eq(searchTermsDaily.campaignId, campaignId as string));
      if (adGroupId) conditions.push(eq(searchTermsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          searchTerm: sql<string>`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          country: sql<string>`MAX(${searchTermsDaily.country})`,
          campaignName: sql<string>`MAX(${searchTermsDaily.campaignName})`,
          adGroupName: sql<string>`MAX(${searchTermsDaily.adGroupName})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`);

      const terms = results.map(row => ({
        searchTerm: row.searchTerm,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        cpc: Number(row.clicks) > 0 ? Number(row.cost) / Number(row.clicks) : 0,
        currentBid: null,
        country: row.country,
        campaign: row.campaignName,
        adGroup: row.adGroupName,
      }));

      const negatives = detectNegativeKeywords(terms);

      // Add country/campaign/adGroup info
      const enrichedNegatives = negatives.map(neg => {
        const term = terms.find(t => t.searchTerm === neg.searchTerm);
        return {
          ...neg,
          country: term?.country,
          campaign: term?.campaign,
          adGroup: term?.adGroup,
        };
      });

      res.json(enrichedNegatives);
    } catch (error) {
      console.error('Negative keywords error:', error);
      res.status(500).json({ error: 'Failed to fetch negative keywords' });
    }
  });

  // Export negative keywords as Excel
  app.get("/api/exports/negatives.xlsx", async (req, res) => {
    try {
      const { country, campaignId, adGroupId, from, to } = req.query;
      
      const conditions = [];
      if (country) conditions.push(eq(searchTermsDaily.country, country as string));
      if (campaignId) conditions.push(eq(searchTermsDaily.campaignId, campaignId as string));
      if (adGroupId) conditions.push(eq(searchTermsDaily.adGroupId, adGroupId as string));
      if (from) conditions.push(gte(searchTermsDaily.dt, from as string));
      if (to) conditions.push(lte(searchTermsDaily.dt, to as string));

      const results = await db
        .select({
          searchTerm: sql<string>`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`,
          clicks: sql<number>`COALESCE(SUM(${searchTermsDaily.clicks}), 0)`,
          cost: sql<number>`COALESCE(SUM(${searchTermsDaily.cost}), 0)`,
          sales: sql<number>`COALESCE(SUM(${searchTermsDaily.sales7d}), 0)`,
          country: sql<string>`MAX(${searchTermsDaily.country})`,
          campaignName: sql<string>`MAX(${searchTermsDaily.campaignName})`,
          adGroupName: sql<string>`MAX(${searchTermsDaily.adGroupName})`,
        })
        .from(searchTermsDaily)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(sql`COALESCE(${searchTermsDaily.searchTerm}, ${searchTermsDaily.targeting})`);

      const terms = results.map(row => ({
        searchTerm: row.searchTerm,
        clicks: Number(row.clicks),
        cost: Number(row.cost),
        sales: Number(row.sales),
        cpc: 0,
        currentBid: null,
        country: row.country,
        campaign: row.campaignName,
        adGroup: row.adGroupName,
      }));

      const negatives = detectNegativeKeywords(terms);

      const excelData = negatives.map(neg => {
        const term = terms.find(t => t.searchTerm === neg.searchTerm);
        return {
          Country: term?.country,
          Campaign: term?.campaign,
          'Ad Group': term?.adGroup,
          Term: neg.searchTerm,
          Type: neg.type,
          Clicks: neg.clicks,
          Cost: neg.cost.toFixed(2),
          Rationale: neg.rationale,
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, 'Negative Keywords');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Disposition', 'attachment; filename=negative_keywords.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Failed to export negative keywords' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
