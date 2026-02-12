import { sql } from "drizzle-orm";
import { pgTable, text, numeric, timestamp, bigint, doublePrecision, date as pgDate, varchar, jsonb, char, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Brand Search Terms table - clean numeric types
export const brandSearchTerms = pgTable('s_brand_search_terms', {
  id: bigint("id", { mode: "number" }).primaryKey(),
  date: pgDate("date"),
  searchTerm: text("search_term"),
  impressions: bigint("impressions", { mode: "number" }),
  clicks: bigint("clicks", { mode: "number" }),
  cost: numeric("cost"),
  purchases: bigint("purchases", { mode: "number" }),
  sales: numeric("sales"),
  unitsSold: bigint("units_sold", { mode: "number" }),
  purchasesClicks: bigint("purchases_clicks", { mode: "number" }),
  salesClicks: numeric("sales_clicks"),
  
  // Keyword info
  keywordId: bigint("keyword_id", { mode: "number" }),
  keywordText: text("keyword_text"),
  keywordType: text("keyword_type"),
  keywordBid: numeric("keyword_bid"),
  adKeywordStatus: text("ad_keyword_status"),
  matchType: text("match_type"),
  
  // Campaign info
  campaignId: bigint("campaign_id", { mode: "number" }),
  campaignName: text("campaign_name"),
  campaignStatus: text("campaign_status"),
  campaignBudgetType: text("campaign_budget_type"),
  campaignBudgetAmount: numeric("campaign_budget_amount"),
  campaignBudgetCurrencyCode: char("campaign_budget_currency_code", { length: 3 }),
  
  // Ad group info
  adGroupId: bigint("ad_group_id", { mode: "number" }),
  adGroupName: text("ad_group_name"),
  
  // Metadata
  rawPayload: jsonb("raw_payload"),
  ingestedAt: timestamp("ingested_at"),
  country: text("country"),
}, (table) => ({
  // Performance indexes for common query patterns
  dateCountryIdx: index("brand_search_terms_date_country_idx").on(table.date, table.country),
  dateCampaignIdx: index("brand_search_terms_date_campaign_idx").on(table.date, table.campaignId),
}));

// Brand Placement table - clean numeric types
export const brandPlacement = pgTable('s_brand_placement', {
  date: pgDate("date"),
  campaignId: bigint("campaignId", { mode: "number" }),
  campaignName: text("campaignName"),
  campaignStatus: text("campaignStatus"),
  costType: text("costType"),
  impressions: bigint("impressions", { mode: "number" }),
  viewableImpressions: bigint("viewableImpressions", { mode: "number" }),
  viewabilityRate: numeric("viewabilityRate"),
  clicks: bigint("clicks", { mode: "number" }),
  cost: numeric("cost"),
  purchases: bigint("purchases", { mode: "number" }),
  sales: numeric("sales"),
  unitsSold: bigint("unitsSold", { mode: "number" }),
  newToBrandPurchases: bigint("newToBrandPurchases", { mode: "number" }),
  newToBrandSales: numeric("newToBrandSales"),
  newToBrandUnitsSold: bigint("newToBrandUnitsSold", { mode: "number" }),
  brandedSearches: bigint("brandedSearches", { mode: "number" }),
  insertedAt: timestamp("insertedAt"),
  updatedAt: timestamp("updatedAt"),
  id: bigint("id", { mode: "number" }).primaryKey(),
  country: text("country"),
});

// Product Search Terms table - TEXT columns (legacy structure)
// NOTE: The "targeting" column contains the keyword/ASIN you bid on (what you set bids for)
// The "searchTerm" column contains what the customer actually searched for
// Bid recommendations should be grouped by "targeting", not "searchTerm"
export const productSearchTerms = pgTable('s_products_search_terms', {
  id: bigint("id", { mode: "number" }).primaryKey(),
  
  // Performance metrics (numeric types)
  impressions: bigint("impressions", { mode: "number" }),
  clicks: bigint("clicks", { mode: "number" }),
  costPerClick: doublePrecision("costPerClick"),
  clickThroughRate: doublePrecision("clickThroughRate"),
  cost: doublePrecision("cost"),
  spend: doublePrecision("spend"),
  
  // Purchase metrics (TEXT - need casting)
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
  
  // Sales metrics (TEXT)
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
  
  // ACOS and ROAS (TEXT)
  acosClicks7d: text("acosClicks7d"),
  acosClicks14d: text("acosClicks14d"),
  roasClicks7d: text("roasClicks7d"),
  roasClicks14d: text("roasClicks14d"),
  
  // Keyword information
  keywordId: bigint("keywordId", { mode: "number" }),
  keyword: text("keyword"),
  
  // Campaign metadata
  campaignBudgetCurrencyCode: text("campaignBudgetCurrencyCode"),
  date: text("date"),
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
}, (table) => ({
  // Performance indexes for common query patterns
  dateCountryIdx: index("product_search_terms_date_country_idx").on(table.date, table.country),
  dateCampaignIdx: index("product_search_terms_date_campaign_idx").on(table.date, table.campaignId),
  dateAdGroupIdx: index("product_search_terms_date_adgroup_idx").on(table.date, table.adGroupId),
}));

// Product Placement table - TEXT columns (legacy structure)
export const productPlacement = pgTable("s_products_placement", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  date: text("date"),
  retailer: text("retailer"),
  campaignPlacement: text("campaignPlacement"),
  placementClassification: text("placementClassification"),
  
  // All metrics are TEXT - require casting
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

// Display Matched Target table - clean numeric types (equivalent to "Search Terms" for Display)
export const displayMatchedTarget = pgTable('s_display_matched_target', {
  id: bigint("id", { mode: "number" }).primaryKey(),
  date: pgDate("date"),
  country: text("country"),
  
  // Campaign info
  campaignId: bigint("campaignId", { mode: "number" }),
  campaignName: text("campaignName"),
  
  // Ad group info
  adGroupId: bigint("adGroupId", { mode: "number" }),
  adGroupName: text("adGroupName"),
  
  // Targeting info (like search terms)
  targetingId: bigint("targetingId", { mode: "number" }),
  targetingText: text("targetingText"),
  targetingExpression: text("targetingExpression"),
  matchedTargetAsin: text("matchedTargetAsin"),
  
  // Currency
  campaignBudgetCurrencyCode: text("campaignBudgetCurrencyCode"),
  
  // Performance metrics - clean numeric types
  cost: numeric("cost"),
  sales: numeric("sales"),
  salesClicks: numeric("salesClicks"),
  salesPromotedClicks: numeric("salesPromotedClicks"),
  newToBrandSales: numeric("newToBrandSales"),
  newToBrandSalesClicks: numeric("newToBrandSalesClicks"),
  eCPBrandSearch: numeric("eCPBrandSearch"),
  eCPAddToCart: numeric("eCPAddToCart"),
  
  impressions: bigint("impressions", { mode: "number" }),
  impressionsViews: bigint("impressionsViews", { mode: "number" }),
  clicks: bigint("clicks", { mode: "number" }),
  purchases: bigint("purchases", { mode: "number" }),
  purchasesClicks: bigint("purchasesClicks", { mode: "number" }),
  purchasesPromotedClicks: bigint("purchasesPromotedClicks", { mode: "number" }),
  detailPageViews: bigint("detailPageViews", { mode: "number" }),
  detailPageViewsClicks: bigint("detailPageViewsClicks", { mode: "number" }),
  unitsSold: bigint("unitsSold", { mode: "number" }),
  unitsSoldClicks: bigint("unitsSoldClicks", { mode: "number" }),
  
  // New to brand metrics
  newToBrandPurchases: bigint("newToBrandPurchases", { mode: "number" }),
  newToBrandPurchasesClicks: bigint("newToBrandPurchasesClicks", { mode: "number" }),
  newToBrandUnitsSold: bigint("newToBrandUnitsSold", { mode: "number" }),
  newToBrandUnitsSoldClicks: bigint("newToBrandUnitsSoldClicks", { mode: "number" }),
  
  // Branded searches
  brandedSearches: bigint("brandedSearches", { mode: "number" }),
  brandedSearchesClicks: bigint("brandedSearchesClicks", { mode: "number" }),
  brandedSearchesViews: bigint("brandedSearchesViews", { mode: "number" }),
  
  // Video metrics
  videoCompleteViews: bigint("videoCompleteViews", { mode: "number" }),
  videoFirstQuartileViews: bigint("videoFirstQuartileViews", { mode: "number" }),
  videoMidpointViews: bigint("videoMidpointViews", { mode: "number" }),
  videoThirdQuartileViews: bigint("videoThirdQuartileViews", { mode: "number" }),
  videoUnmutes: bigint("videoUnmutes", { mode: "number" }),
  
  // Engagement metrics
  addToCart: bigint("addToCart", { mode: "number" }),
  addToCartViews: bigint("addToCartViews", { mode: "number" }),
  addToCartClicks: bigint("addToCartClicks", { mode: "number" }),
  
  // Kindle metrics
  qualifiedBorrows: bigint("qualifiedBorrows", { mode: "number" }),
  qualifiedBorrowsFromClicks: bigint("qualifiedBorrowsFromClicks", { mode: "number" }),
  qualifiedBorrowsFromViews: bigint("qualifiedBorrowsFromViews", { mode: "number" }),
  royaltyQualifiedBorrows: bigint("royaltyQualifiedBorrows", { mode: "number" }),
  royaltyQualifiedBorrowsFromClicks: bigint("royaltyQualifiedBorrowsFromClicks", { mode: "number" }),
  royaltyQualifiedBorrowsFromViews: bigint("royaltyQualifiedBorrowsFromViews", { mode: "number" }),
  
  // List metrics
  addToList: bigint("addToList", { mode: "number" }),
  addToListFromClicks: bigint("addToListFromClicks", { mode: "number" }),
  addToListFromViews: bigint("addToListFromViews", { mode: "number" }),
  
  // Lead metrics
  linkOuts: bigint("linkOuts", { mode: "number" }),
  leadFormOpens: bigint("leadFormOpens", { mode: "number" }),
  leads: bigint("leads", { mode: "number" }),
  
  // Rate metrics
  brandedSearchRate: numeric("brandedSearchRate"),
  viewabilityRate: numeric("viewabilityRate"),
  viewClickThroughRate: numeric("viewClickThroughRate"),
  addToCartRate: numeric("addToCartRate"),
  
  created_at: timestamp("created_at"),
}, (table) => ({
  // Performance indexes for common query patterns
  dateCountryIdx: index("display_matched_target_date_country_idx").on(table.date, table.country),
  dateCampaignIdx: index("display_matched_target_date_campaign_idx").on(table.date, table.campaignId),
}));

// Display Targeting table - clean numeric types (equivalent to "Placements" for Display)
export const displayTargeting = pgTable('s_display_targeting', {
  id: bigint("id", { mode: "number" }).primaryKey(),
  date: pgDate("date"),
  country: text("country"),
  
  // Campaign info
  campaignId: bigint("campaignId", { mode: "number" }),
  campaignName: text("campaignName"),
  
  // Ad group info
  adGroupId: bigint("adGroupId", { mode: "number" }),
  adGroupName: text("adGroupName"),
  
  // Targeting info
  targetingId: bigint("targetingId", { mode: "number" }),
  targetingText: text("targetingText"),
  targetingExpression: text("targetingExpression"),
  
  // Currency
  campaignBudgetCurrencyCode: text("campaignBudgetCurrencyCode"),
  
  // Performance metrics - clean numeric types
  cost: numeric("cost"),
  sales: numeric("sales"),
  salesClicks: numeric("salesClicks"),
  salesPromotedClicks: numeric("salesPromotedClicks"),
  newToBrandSales: numeric("newToBrandSales"),
  newToBrandSalesClicks: numeric("newToBrandSalesClicks"),
  eCPBrandSearch: numeric("eCPBrandSearch"),
  eCPAddToCart: numeric("eCPAddToCart"),
  newToBrandECPDetailPageView: numeric("newToBrandECPDetailPageView"),
  
  impressions: bigint("impressions", { mode: "number" }),
  impressionsViews: bigint("impressionsViews", { mode: "number" }),
  clicks: bigint("clicks", { mode: "number" }),
  purchases: bigint("purchases", { mode: "number" }),
  purchasesClicks: bigint("purchasesClicks", { mode: "number" }),
  purchasesPromotedClicks: bigint("purchasesPromotedClicks", { mode: "number" }),
  detailPageViews: bigint("detailPageViews", { mode: "number" }),
  detailPageViewsClicks: bigint("detailPageViewsClicks", { mode: "number" }),
  unitsSold: bigint("unitsSold", { mode: "number" }),
  unitsSoldClicks: bigint("unitsSoldClicks", { mode: "number" }),
  
  // New to brand metrics
  newToBrandPurchases: bigint("newToBrandPurchases", { mode: "number" }),
  newToBrandPurchasesClicks: bigint("newToBrandPurchasesClicks", { mode: "number" }),
  newToBrandUnitsSold: bigint("newToBrandUnitsSold", { mode: "number" }),
  newToBrandUnitsSoldClicks: bigint("newToBrandUnitsSoldClicks", { mode: "number" }),
  
  // Branded searches
  brandedSearches: bigint("brandedSearches", { mode: "number" }),
  brandedSearchesClicks: bigint("brandedSearchesClicks", { mode: "number" }),
  brandedSearchesViews: bigint("brandedSearchesViews", { mode: "number" }),
  
  // Video metrics
  videoCompleteViews: bigint("videoCompleteViews", { mode: "number" }),
  videoFirstQuartileViews: bigint("videoFirstQuartileViews", { mode: "number" }),
  videoMidpointViews: bigint("videoMidpointViews", { mode: "number" }),
  videoThirdQuartileViews: bigint("videoThirdQuartileViews", { mode: "number" }),
  videoUnmutes: bigint("videoUnmutes", { mode: "number" }),
  
  // Engagement metrics
  addToCart: bigint("addToCart", { mode: "number" }),
  addToCartViews: bigint("addToCartViews", { mode: "number" }),
  addToCartClicks: bigint("addToCartClicks", { mode: "number" }),
  
  // Kindle metrics
  qualifiedBorrows: bigint("qualifiedBorrows", { mode: "number" }),
  qualifiedBorrowsFromClicks: bigint("qualifiedBorrowsFromClicks", { mode: "number" }),
  qualifiedBorrowsFromViews: bigint("qualifiedBorrowsFromViews", { mode: "number" }),
  royaltyQualifiedBorrows: bigint("royaltyQualifiedBorrows", { mode: "number" }),
  royaltyQualifiedBorrowsFromClicks: bigint("royaltyQualifiedBorrowsFromClicks", { mode: "number" }),
  royaltyQualifiedBorrowsFromViews: bigint("royaltyQualifiedBorrowsFromViews", { mode: "number" }),
  
  // List metrics
  addToList: bigint("addToList", { mode: "number" }),
  addToListFromClicks: bigint("addToListFromClicks", { mode: "number" }),
  addToListFromViews: bigint("addToListFromViews", { mode: "number" }),
  
  // Lead metrics
  linkOuts: bigint("linkOuts", { mode: "number" }),
  leadFormOpens: bigint("leadFormOpens", { mode: "number" }),
  leads: bigint("leads", { mode: "number" }),
  
  // New to brand detail page views
  newToBrandDetailPageViews: bigint("newToBrandDetailPageViews", { mode: "number" }),
  newToBrandDetailPageViewViews: bigint("newToBrandDetailPageViewViews", { mode: "number" }),
  newToBrandDetailPageViewClicks: bigint("newToBrandDetailPageViewClicks", { mode: "number" }),
  
  // Rate metrics
  brandedSearchRate: numeric("brandedSearchRate"),
  viewabilityRate: numeric("viewabilityRate"),
  viewClickThroughRate: numeric("viewClickThroughRate"),
  addToCartRate: numeric("addToCartRate"),
  newToBrandDetailPageViewRate: numeric("newToBrandDetailPageViewRate"),
  
  adKeywordStatus: text("adKeywordStatus"),
  created_at: timestamp("created_at"),
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

// Bid Change History table - tracks when keyword bids are adjusted
// Used to analyze performance since last bid change
// Supports Sponsored Products and Sponsored Brands only (Display lacks bid data)
export const bidChangeHistory = pgTable('bid_change_history', {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  
  // Campaign type: 'products' or 'brands'
  campaignType: text("campaign_type").notNull(),
  
  // Targeting identifier (keyword/ASIN you bid on)
  targeting: text("targeting").notNull(),
  
  // Campaign and Ad Group identifiers
  campaignId: bigint("campaign_id", { mode: "number" }).notNull(),
  adGroupId: bigint("ad_group_id", { mode: "number" }),
  
  // Names for context/display
  campaignName: text("campaign_name"),
  adGroupName: text("ad_group_name"),
  
  // Country for currency context
  country: text("country"),
  
  // Bid change details
  dateAdjusted: pgDate("date_adjusted").notNull(),
  currentBid: numeric("current_bid").notNull(),
  previousBid: numeric("previous_bid").notNull(),
  
  // Match type for keyword targeting
  matchType: text("match_type"),
  
  // Record metadata
  createdAt: timestamp("created_at").defaultNow(),
});

export type InsertBidChangeHistory = {
  campaignType: string;
  targeting: string;
  campaignId: number;
  adGroupId?: number | null;
  campaignName?: string | null;
  adGroupName?: string | null;
  country?: string | null;
  dateAdjusted: string;
  currentBid: string;
  previousBid: string;
  matchType?: string | null;
};
export type BidChangeHistory = typeof bidChangeHistory.$inferSelect;

export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type BrandSearchTerm = typeof brandSearchTerms.$inferSelect;
export type BrandPlacement = typeof brandPlacement.$inferSelect;
export type ProductSearchTerm = typeof productSearchTerms.$inferSelect;
export type ProductPlacement = typeof productPlacement.$inferSelect;
export type DisplayMatchedTarget = typeof displayMatchedTarget.$inferSelect;
export type DisplayTargeting = typeof displayTargeting.$inferSelect;
