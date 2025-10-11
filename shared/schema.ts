import { sql } from "drizzle-orm";
import { pgTable, text, varchar, numeric, timestamp, date, integer, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const searchTermsDaily = pgTable("sp_search_terms_daily_from22-09-2025", {
  id: integer("id").primaryKey(),
  impressions: integer("impressions"),
  clicks: integer("clicks"),
  costPerClick: numeric("costPerClick"),
  clickThroughRate: numeric("clickThroughRate"),
  cost: numeric("cost"),
  spend: numeric("spend"),
  purchases1d: integer("purchases1d"),
  purchases7d: integer("purchases7d"),
  purchases14d: integer("purchases14d"),
  purchases30d: integer("purchases30d"),
  purchasesSameSku1d: integer("purchasesSameSku1d"),
  purchasesSameSku7d: integer("purchasesSameSku7d"),
  purchasesSameSku14d: integer("purchasesSameSku14d"),
  purchasesSameSku30d: integer("purchasesSameSku30d"),
  unitsSoldClicks1d: integer("unitsSoldClicks1d"),
  unitsSoldClicks7d: integer("unitsSoldClicks7d"),
  unitsSoldClicks14d: integer("unitsSoldClicks14d"),
  unitsSoldClicks30d: integer("unitsSoldClicks30d"),
  sales1d: numeric("sales1d"),
  sales7d: numeric("sales7d"),
  sales14d: numeric("sales14d"),
  sales30d: numeric("sales30d"),
  attributedSalesSameSku1d: numeric("attributedSalesSameSku1d"),
  attributedSalesSameSku7d: numeric("attributedSalesSameSku7d"),
  attributedSalesSameSku14d: numeric("attributedSalesSameSku14d"),
  attributedSalesSameSku30d: numeric("attributedSalesSameSku30d"),
  unitsSoldSameSku1d: integer("unitsSoldSameSku1d"),
  unitsSoldSameSku7d: integer("unitsSoldSameSku7d"),
  unitsSoldSameSku14d: integer("unitsSoldSameSku14d"),
  unitsSoldSameSku30d: integer("unitsSoldSameSku30d"),
  campaignId: text("campaignId"),
  searchTerm: text("searchTerm"),
  targeting: text("targeting"),
  currency: text("currency"),
  dt: date("dt"),
  adGroupId: text("adGroupId"),
  adGroupName: text("adGroupName"),
  campaignName: text("campaignName"),
  campaignBudgetType: text("campaignBudgetType"),
  campaignBudget: numeric("campaignBudget"),
  campaignStatus: text("campaignStatus"),
  keywordBid: numeric("keywordBid"),
  portfolioName: text("portfolioName"),
  portfolioId: text("portfolioId"),
  matchType: text("matchType"),
  keywordType: text("keywordType"),
  country: text("country"),
  createdAt: timestamp("createdAt").defaultNow(),
});

export const placementsDaily = pgTable("sp_placement_daily_v2", {
  id: integer("id").primaryKey(),
  dt: date("dt"),
  country: text("country"),
  campaignId: text("campaignId"),
  adGroupId: text("adGroupId"),
  placement: text("placement"),
  clicks: integer("clicks"),
  cost: numeric("cost"),
  sales: numeric("sales"),
  impressions: integer("impressions"),
});

export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
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
