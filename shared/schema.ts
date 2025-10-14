import { sql } from "drizzle-orm";
import { pgTable, text, numeric, timestamp, bigint, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Match the actual s_products_searchterms table structure
export const searchTermsDaily = pgTable('s_products_searchterms', {
  id: bigint("id", { mode: "number" }).primaryKey(),
  // Performance metrics (numeric types)
  impressions: bigint("impressions", { mode: "number" }),
  clicks: bigint("clicks", { mode: "number" }),
  costPerClick: doublePrecision("costPerClick"),
  clickThroughRate: doublePrecision("clickThroughRate"),
  cost: doublePrecision("cost"),
  spend: doublePrecision("spend"),
  
  // Purchase metrics (TEXT in database - need casting for aggregation)
  purchases1d: text("purchases1d"),
  purchases7d: text("purchases7d"),
  purchases14d: text("purchases14d"),
  purchases30d: text("purchases30d"),
  purchasesSameSku1d: text("purchasesSameSku1d"),
  purchasesSameSku7d: text("purchasesSameSku7d"),
  purchasesSameSku14d: text("purchasesSameSku14d"),
  purchasesSameSku30d: text("purchasesSameSku30d"),
  
  // Units sold metrics (TEXT)
  unitsSoldClicks1d: text("unitsSoldClicks1d"),
  unitsSoldClicks7d: text("unitsSoldClicks7d"),
  unitsSoldClicks14d: text("unitsSoldClicks14d"),
  unitsSoldClicks30d: text("unitsSoldClicks30d"),
  
  // Sales metrics (TEXT in database)
  sales1d: text("sales1d"),
  sales7d: text("sales7d"),
  sales14d: text("sales14d"),
  sales30d: text("sales30d"),
  attributedSalesSameSku1d: text("attributedSalesSameSku1d"),
  attributedSalesSameSku7d: text("attributedSalesSameSku7d"),
  attributedSalesSameSku14d: text("attributedSalesSameSku14d"),
  attributedSalesSameSku30d: text("attributedSalesSameSku30d"),
  
  // Same SKU units sold (TEXT)
  unitsSoldSameSku1d: text("unitsSoldSameSku1d"),
  unitsSoldSameSku7d: text("unitsSoldSameSku7d"),
  unitsSoldSameSku14d: text("unitsSoldSameSku14d"),
  unitsSoldSameSku30d: text("unitsSoldSameSku30d"),
  
  // Kindle metrics (TEXT)
  kindleEditionNormalizedPagesRead14d: text("kindleEditionNormalizedPagesRead14d"),
  kindleEditionNormalizedPagesRoyalties14d: text("kindleEditionNormalizedPagesRoyalties14d"),
  qualifiedBorrows: text("qualifiedBorrows"),
  royaltyQualifiedBorrows: text("royaltyQualifiedBorrows"),
  
  // Additional metrics (TEXT)
  addToList: text("addToList"),
  salesOtherSku7d: text("salesOtherSku7d"),
  salesOtherSku14d: text("salesOtherSku14d"),
  unitsSoldOtherSku7d: text("unitsSoldOtherSku7d"),
  unitsSoldOtherSku14d: text("unitsSoldOtherSku14d"),
  purchaseClickRate14d: text("purchaseClickRate14d"),
  
  // ACOS and ROAS (TEXT in database)
  acosClicks7d: text("acosClicks7d"),
  acosClicks14d: text("acosClicks14d"),
  roasClicks7d: text("roasClicks7d"),
  roasClicks14d: text("roasClicks14d"),
  
  // Keyword information
  keywordId: bigint("keywordId", { mode: "number" }),
  keyword: text("keyword"),
  
  // Campaign metadata
  campaignBudgetCurrencyCode: text("campaignBudgetCurrencyCode"),
  date: text("date"), // TEXT format date
  portfolioId: bigint("portfolioId", { mode: "number" }),
  searchTerm: text("searchTerm"),
  campaignName: text("campaignName"),
  campaignId: bigint("campaignId", { mode: "number" }),
  campaignBudgetType: text("campaignBudgetType"),
  campaignBudgetAmount: numeric("campaignBudgetAmount"),
  campaignStatus: text("campaignStatus"),
  keywordBid: doublePrecision("keywordBid"),
  
  // Ad group metadata
  adGroupName: text("adGroupName"),
  adGroupId: bigint("adGroupId", { mode: "number" }),
  keywordType: text("keywordType"),
  matchType: text("matchType"),
  targeting: text("targeting"),
  
  // Additional metadata
  retailer: text("retailer"),
  createdAt: timestamp("createdAt"),
  country: text("country"),
});

export const placementsDaily = pgTable("sp_placement_daily_v2", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  date: text("date"),
  retailer: text("retailer"),
  campaignPlacement: text("campaignPlacement"),
  
  // All metrics are TEXT - require casting for aggregation
  impressions: text("impressions"),
  clicks: text("clicks"),
  cost: text("cost"),
  spend: text("spend"),
  costPerClick: text("costPerClick"),
  clickThroughRate: text("clickThroughRate"),
  
  // Purchase metrics (TEXT)
  purchases1d: text("purchases1d"),
  purchases7d: text("purchases7d"),
  purchases14d: text("purchases14d"),
  purchases30d: text("purchases30d"),
  purchasesSameSku1d: text("purchasesSameSku1d"),
  purchasesSameSku7d: text("purchasesSameSku7d"),
  purchasesSameSku14d: text("purchasesSameSku14d"),
  purchasesSameSku30d: text("purchasesSameSku30d"),
  
  // Units sold (TEXT)
  unitsSoldClicks1d: text("unitsSoldClicks1d"),
  unitsSoldClicks7d: text("unitsSoldClicks7d"),
  unitsSoldClicks14d: text("unitsSoldClicks14d"),
  unitsSoldClicks30d: text("unitsSoldClicks30d"),
  
  // Sales metrics (TEXT)
  sales1d: text("sales1d"),
  sales7d: text("sales7d"),
  sales14d: text("sales14d"),
  sales30d: text("sales30d"),
  attributedSalesSameSku1d: text("attributedSalesSameSku1d"),
  attributedSalesSameSku7d: text("attributedSalesSameSku7d"),
  attributedSalesSameSku14d: text("attributedSalesSameSku14d"),
  attributedSalesSameSku30d: text("attributedSalesSameSku30d"),
  
  // Same SKU units (TEXT)
  unitsSoldSameSku1d: text("unitsSoldSameSku1d"),
  unitsSoldSameSku7d: text("unitsSoldSameSku7d"),
  unitsSoldSameSku14d: text("unitsSoldSameSku14d"),
  unitsSoldSameSku30d: text("unitsSoldSameSku30d"),
  
  // Kindle metrics (TEXT)
  kindleEditionNormalizedPagesRead14d: text("kindleEditionNormalizedPagesRead14d"),
  kindleEditionNormalizedPagesRoyalties14d: text("kindleEditionNormalizedPagesRoyalties14d"),
  qualifiedBorrows: text("qualifiedBorrows"),
  royaltyQualifiedBorrows: text("royaltyQualifiedBorrows"),
  
  // Additional metrics (TEXT)
  addToList: text("addToList"),
  campaignBiddingStrategy: text("campaignBiddingStrategy"),
  acosClicks14d: text("acosClicks14d"),
  roasClicks14d: text("roasClicks14d"),
  
  // Metadata
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at"),
  country: text("country"),
  campaignId: bigint("campaignId", { mode: "number" }),
  campaignName: text("campaignName"),
  upload_id: text("upload_id"),
});

export const recommendations = pgTable("recommendations", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: text("scope").notNull(),
  scopeId: text("scopeId"),
  generatedFor: text("generatedFor").notNull(),
  targetAcos: numeric("targetAcos").notNull().default(sql`0.20`),
  items: text("items").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true,
  createdAt: true,
});

export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type SearchTermDaily = typeof searchTermsDaily.$inferSelect;
export type PlacementDaily = typeof placementsDaily.$inferSelect;
