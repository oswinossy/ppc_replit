import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { brandSearchTerms, productSearchTerms, displayMatchedTarget, brandPlacement, productPlacement, displayTargeting } from "@shared/schema";
import { sql, eq, gte, lte, and } from "drizzle-orm";
import { calculateACOS, calculateCPC, calculateCVR } from "./utils/calculations";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert Amazon PPC (Pay-Per-Click) advertising analyst working within the Elan analytics portal. You help users understand and optimize their Amazon advertising campaigns.

## Your Expertise
- Amazon Sponsored Products, Sponsored Brands, and Display campaigns
- Key metrics: ACOS (Advertising Cost of Sales), CPC (Cost Per Click), CVR (Conversion Rate), ROAS (Return on Ad Spend)
- Bid optimization strategies targeting 20% ACOS
- Negative keyword identification
- Campaign performance analysis

## Data Context
You have access to tools that query real campaign data from the database. The data includes:
- Campaign performance across multiple countries (DE, US, UK, FR, ES, IT, SE, PL, JP)
- Metrics: clicks, cost, sales, orders, ACOS, CPC, CVR
- Campaign types: Sponsored Products (30-day attribution), Sponsored Brands, Display
- All monetary values are displayed in EUR (converted using ECB exchange rates)
- Placement-level performance data (Top of Search, Product Pages, Rest of Search, Off Amazon)
- Display targeting data with targeting expressions and performance metrics
- Daily-level metrics for trend analysis and anomaly detection
- Data coverage information to identify missing dates and gaps in the data

## Guidelines
1. Always use the available tools to fetch real data before answering questions
2. Provide specific, actionable insights based on the data
3. When discussing bid recommendations, explain the reasoning (ACOS-based formula)
4. Format numbers clearly: percentages with 1 decimal, currency with 2 decimals
5. Be concise but thorough in your analysis
6. If data is insufficient, say so rather than making assumptions

## ACOS Interpretation
- Green (Good): ACOS < 20%
- Amber (Watch): ACOS 20-30%
- Red (High): ACOS > 30%

## Bid Recommendation Formula
- Target Bid = Current Bid × (Target ACOS / Current ACOS)
- Safeguards: 20% to 150% of base bid
- Minimum 30 clicks required for reliable recommendations`;

// Define available tools for the agent
const tools: Anthropic.Tool[] = [
  {
    name: "get_kpis",
    description: "Get overall KPI summary (total sales, cost, ACOS, orders, clicks) for a date range. Can filter by country and campaign type.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code (e.g., DE, US, UK)"
        },
        campaignType: {
          type: "string",
          enum: ["products", "brands", "display"],
          description: "Campaign type filter. Defaults to products."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_campaigns",
    description: "Get list of campaigns with performance metrics. Returns campaign name, sales, cost, ACOS, clicks, orders.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code (e.g., DE, US, UK)"
        },
        campaignType: {
          type: "string",
          enum: ["products", "brands", "display"],
          description: "Campaign type filter"
        },
        limit: {
          type: "number",
          description: "Maximum number of campaigns to return. Default 10."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_countries_performance",
    description: "Get performance breakdown by country. Shows sales, cost, ACOS for each country.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        campaignType: {
          type: "string",
          enum: ["products", "brands", "display"],
          description: "Campaign type filter"
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_top_search_terms",
    description: "Get top performing or worst performing search terms based on criteria.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        sortBy: {
          type: "string",
          enum: ["sales", "cost", "clicks", "acos"],
          description: "Metric to sort by"
        },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort order"
        },
        limit: {
          type: "number",
          description: "Number of results to return. Default 10."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_negative_keyword_candidates",
    description: "Find search terms with high clicks but zero sales - candidates for negative keywords.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        minClicks: {
          type: "number",
          description: "Minimum clicks threshold. Default 20."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_product_placements",
    description: "Get Sponsored Products placement-level performance data. Shows performance breakdown by placement type (Top of Search, Product Pages, Rest of Search).",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        campaignId: {
          type: "number",
          description: "Optional campaign ID to filter by specific campaign"
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_brand_placements",
    description: "Get Sponsored Brands placement-level performance data. Shows impressions, clicks, cost, sales by placement.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        campaignId: {
          type: "number",
          description: "Optional campaign ID to filter by specific campaign"
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_display_targeting",
    description: "Get Display campaign targeting performance data. Shows performance by targeting expression (audience, product targeting, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        campaignId: {
          type: "number",
          description: "Optional campaign ID to filter by specific campaign"
        },
        limit: {
          type: "number",
          description: "Maximum number of results. Default 20."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_data_coverage",
    description: "Check data coverage and identify missing dates. Returns record counts per day for each table to find gaps in the data.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code to filter"
        },
        tables: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tables to check. Options: products_search_terms, products_placement, brands_search_terms, brands_placement, display_matched_target, display_targeting. Defaults to all."
        }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "get_daily_breakdown",
    description: "Get daily-level metrics breakdown for trend analysis and anomaly detection. Returns sales, cost, clicks, orders, and ACOS for each day.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Start date in YYYY-MM-DD format"
        },
        to: {
          type: "string",
          description: "End date in YYYY-MM-DD format"
        },
        country: {
          type: "string",
          description: "Optional country code"
        },
        campaignType: {
          type: "string",
          enum: ["products", "brands", "display"],
          description: "Campaign type filter. Defaults to products."
        },
        campaignId: {
          type: "number",
          description: "Optional campaign ID to filter by specific campaign"
        }
      },
      required: ["from", "to"]
    }
  }
];

// Tool execution functions
async function executeGetKpis(params: { from: string; to: string; country?: string; campaignType?: string }) {
  const { from, to, country, campaignType = 'products' } = params;
  
  let table: any;
  let salesField: any;
  let ordersField: any;
  
  if (campaignType === 'brands') {
    table = brandSearchTerms;
    salesField = brandSearchTerms.sales;
    ordersField = brandSearchTerms.purchases;
  } else if (campaignType === 'display') {
    table = displayMatchedTarget;
    salesField = displayMatchedTarget.sales;
    ordersField = displayMatchedTarget.purchases;
  } else {
    table = productSearchTerms;
    salesField = sql`NULLIF(${productSearchTerms.sales30d}, '')::numeric`;
    ordersField = sql`NULLIF(${productSearchTerms.purchases30d}, '')::numeric`;
  }
  
  const conditions = [];
  conditions.push(gte(table.date, from));
  conditions.push(lte(table.date, to));
  if (country) conditions.push(eq(table.country, country));
  
  const result = await db
    .select({
      clicks: sql<number>`COALESCE(SUM(${table.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${table.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(${salesField}), 0)`,
      orders: sql<number>`COALESCE(SUM(${ordersField}), 0)`,
    })
    .from(table)
    .where(and(...conditions));
  
  const data = result[0];
  return {
    clicks: Number(data.clicks),
    cost: Number(data.cost),
    sales: Number(data.sales),
    orders: Number(data.orders),
    acos: calculateACOS(Number(data.cost), Number(data.sales)),
    cpc: calculateCPC(Number(data.cost), Number(data.clicks)),
    cvr: calculateCVR(Number(data.orders), Number(data.clicks)),
  };
}

async function executeGetCampaigns(params: { from: string; to: string; country?: string; campaignType?: string; limit?: number }) {
  const { from, to, country, campaignType = 'products', limit = 10 } = params;
  
  let results: any[] = [];
  
  if (campaignType === 'brands') {
    const conditions = [];
    conditions.push(gte(brandSearchTerms.date, from));
    conditions.push(lte(brandSearchTerms.date, to));
    if (country) conditions.push(eq(brandSearchTerms.country, country));
    
    results = await db
      .select({
        campaignId: brandSearchTerms.campaignId,
        campaignName: sql<string>`MAX(${brandSearchTerms.campaignName})`,
        clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
        cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
        sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
        orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
      })
      .from(brandSearchTerms)
      .where(and(...conditions))
      .groupBy(brandSearchTerms.campaignId)
      .limit(limit);
  } else {
    const conditions = [];
    conditions.push(gte(productSearchTerms.date, from));
    conditions.push(lte(productSearchTerms.date, to));
    if (country) conditions.push(eq(productSearchTerms.country, country));
    
    results = await db
      .select({
        campaignId: productSearchTerms.campaignId,
        campaignName: sql<string>`MAX(${productSearchTerms.campaignName})`,
        clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
        cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
        sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
        orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
      })
      .from(productSearchTerms)
      .where(and(...conditions))
      .groupBy(productSearchTerms.campaignId)
      .limit(limit);
  }
  
  return results.map(row => ({
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
  })).sort((a, b) => b.sales - a.sales);
}

async function executeGetCountriesPerformance(params: { from: string; to: string; campaignType?: string }) {
  const { from, to, campaignType = 'products' } = params;
  
  let table: any;
  let salesField: any;
  let ordersField: any;
  
  if (campaignType === 'brands') {
    table = brandSearchTerms;
    salesField = brandSearchTerms.sales;
    ordersField = brandSearchTerms.purchases;
  } else {
    table = productSearchTerms;
    salesField = sql`NULLIF(${productSearchTerms.sales30d}, '')::numeric`;
    ordersField = sql`NULLIF(${productSearchTerms.purchases30d}, '')::numeric`;
  }
  
  const conditions = [];
  conditions.push(gte(table.date, from));
  conditions.push(lte(table.date, to));
  
  const results = await db
    .select({
      country: table.country,
      clicks: sql<number>`COALESCE(SUM(${table.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${table.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(${salesField}), 0)`,
      orders: sql<number>`COALESCE(SUM(${ordersField}), 0)`,
    })
    .from(table)
    .where(and(...conditions))
    .groupBy(table.country);
  
  return results.map(row => ({
    country: row.country,
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
  })).sort((a, b) => b.sales - a.sales);
}

async function executeGetTopSearchTerms(params: { from: string; to: string; country?: string; sortBy?: string; order?: string; limit?: number }) {
  const { from, to, country, sortBy = 'sales', order = 'desc', limit = 10 } = params;
  
  const conditions = [];
  conditions.push(gte(productSearchTerms.date, from));
  conditions.push(lte(productSearchTerms.date, to));
  if (country) conditions.push(eq(productSearchTerms.country, country));
  
  const results = await db
    .select({
      searchTerm: productSearchTerms.searchTerm,
      clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
      orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
    })
    .from(productSearchTerms)
    .where(and(...conditions))
    .groupBy(productSearchTerms.searchTerm)
    .limit(limit * 2); // Fetch more to sort properly
  
  const mapped = results.map(row => ({
    searchTerm: row.searchTerm,
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
  }));
  
  // Sort based on criteria
  mapped.sort((a, b) => {
    const aVal = a[sortBy as keyof typeof a] as number;
    const bVal = b[sortBy as keyof typeof b] as number;
    return order === 'desc' ? bVal - aVal : aVal - bVal;
  });
  
  return mapped.slice(0, limit);
}

async function executeGetNegativeKeywordCandidates(params: { from: string; to: string; country?: string; minClicks?: number }) {
  const { from, to, country, minClicks = 20 } = params;
  
  const conditions = [];
  conditions.push(gte(productSearchTerms.date, from));
  conditions.push(lte(productSearchTerms.date, to));
  if (country) conditions.push(eq(productSearchTerms.country, country));
  
  const results = await db
    .select({
      searchTerm: productSearchTerms.searchTerm,
      clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
    })
    .from(productSearchTerms)
    .where(and(...conditions))
    .groupBy(productSearchTerms.searchTerm);
  
  // Filter for zero sales with high clicks
  const candidates = results
    .filter(row => Number(row.sales) === 0 && Number(row.clicks) >= minClicks)
    .map(row => ({
      searchTerm: row.searchTerm,
      clicks: Number(row.clicks),
      cost: Number(row.cost),
      wastedSpend: Number(row.cost),
    }))
    .sort((a, b) => b.cost - a.cost);
  
  return candidates;
}

// Helper function to normalize placement names
function normalizePlacementName(rawPlacement: string | null): string {
  if (!rawPlacement) return "Unknown";
  const placementMap: Record<string, string> = {
    "Top of Search on-Amazon": "Top of search (first page)",
    "Detail Page on-Amazon": "Product pages",
    "Other on-Amazon": "Rest of search",
    "Off Amazon": "Off Amazon",
  };
  return placementMap[rawPlacement] || rawPlacement;
}

async function executeGetProductPlacements(params: { from: string; to: string; country?: string; campaignId?: number }) {
  const { from, to, country, campaignId } = params;
  
  const conditions = [];
  conditions.push(gte(productPlacement.date, from));
  conditions.push(lte(productPlacement.date, to));
  if (country) conditions.push(eq(productPlacement.country, country));
  if (campaignId) conditions.push(eq(productPlacement.campaignId, campaignId));
  
  const results = await db
    .select({
      placementClassification: productPlacement.placementClassification,
      clicks: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.clicks}, '')::numeric), 0)`,
      cost: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.cost}, '')::numeric), 0)`,
      sales: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.sales30d}, '')::numeric), 0)`,
      orders: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.purchases30d}, '')::numeric), 0)`,
      impressions: sql<number>`COALESCE(SUM(NULLIF(${productPlacement.impressions}, '')::numeric), 0)`,
    })
    .from(productPlacement)
    .where(and(...conditions))
    .groupBy(productPlacement.placementClassification);
  
  return results.map(row => ({
    placement: normalizePlacementName(row.placementClassification),
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    impressions: Number(row.impressions),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
    cpc: calculateCPC(Number(row.cost), Number(row.clicks)),
  })).sort((a, b) => b.sales - a.sales);
}

async function executeGetBrandPlacements(params: { from: string; to: string; country?: string; campaignId?: number }) {
  const { from, to, country, campaignId } = params;
  
  const conditions = [];
  conditions.push(gte(brandPlacement.date, from));
  conditions.push(lte(brandPlacement.date, to));
  if (country) conditions.push(eq(brandPlacement.country, country));
  if (campaignId) conditions.push(eq(brandPlacement.campaignId, campaignId));
  
  const results = await db
    .select({
      costType: brandPlacement.costType,
      clicks: sql<number>`COALESCE(SUM(${brandPlacement.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${brandPlacement.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(${brandPlacement.sales}), 0)`,
      orders: sql<number>`COALESCE(SUM(${brandPlacement.purchases}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${brandPlacement.impressions}), 0)`,
    })
    .from(brandPlacement)
    .where(and(...conditions))
    .groupBy(brandPlacement.costType);
  
  return results.map(row => ({
    costType: row.costType || "Unknown",
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    impressions: Number(row.impressions),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
    cpc: calculateCPC(Number(row.cost), Number(row.clicks)),
  })).sort((a, b) => b.sales - a.sales);
}

async function executeGetDisplayTargeting(params: { from: string; to: string; country?: string; campaignId?: number; limit?: number }) {
  const { from, to, country, campaignId, limit = 20 } = params;
  
  const conditions = [];
  conditions.push(gte(displayTargeting.date, from));
  conditions.push(lte(displayTargeting.date, to));
  if (country) conditions.push(eq(displayTargeting.country, country));
  if (campaignId) conditions.push(eq(displayTargeting.campaignId, campaignId));
  
  const results = await db
    .select({
      targetingText: displayTargeting.targetingText,
      targetingExpression: displayTargeting.targetingExpression,
      clicks: sql<number>`COALESCE(SUM(${displayTargeting.clicks}), 0)`,
      cost: sql<number>`COALESCE(SUM(${displayTargeting.cost}), 0)`,
      sales: sql<number>`COALESCE(SUM(${displayTargeting.sales}), 0)`,
      purchases: sql<number>`COALESCE(SUM(${displayTargeting.purchases}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${displayTargeting.impressions}), 0)`,
    })
    .from(displayTargeting)
    .where(and(...conditions))
    .groupBy(displayTargeting.targetingText, displayTargeting.targetingExpression)
    .limit(limit * 2);
  
  return results.map(row => ({
    targetingText: row.targetingText,
    targetingExpression: row.targetingExpression,
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.purchases),
    impressions: Number(row.impressions),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
    cpc: calculateCPC(Number(row.cost), Number(row.clicks)),
  })).sort((a, b) => b.cost - a.cost).slice(0, limit);
}

// Get data coverage - check for missing dates across tables
async function executeGetDataCoverage(params: { from: string; to: string; country?: string; tables?: string[] }) {
  const { from, to, country, tables } = params;
  
  const allTables = [
    'products_search_terms', 'products_placement',
    'brands_search_terms', 'brands_placement',
    'display_matched_target', 'display_targeting'
  ];
  const tablesToCheck = tables && tables.length > 0 ? tables : allTables;
  
  const results: Record<string, { dates: Record<string, number>; totalRecords: number; datesWithData: number; missingDates: string[] }> = {};
  
  // Generate all dates in range
  const startDate = new Date(from);
  const endDate = new Date(to);
  const allDates: string[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split('T')[0]);
  }
  
  // Tables with TEXT date columns that need casting
  const textDateTables = ['products_search_terms', 'products_placement'];
  
  for (const tableName of tablesToCheck) {
    let table: any;
    let dateField: any;
    const needsCasting = textDateTables.includes(tableName);
    
    switch (tableName) {
      case 'products_search_terms':
        table = productSearchTerms;
        dateField = productSearchTerms.date;
        break;
      case 'products_placement':
        table = productPlacement;
        dateField = productPlacement.date;
        break;
      case 'brands_search_terms':
        table = brandSearchTerms;
        dateField = brandSearchTerms.date;
        break;
      case 'brands_placement':
        table = brandPlacement;
        dateField = brandPlacement.date;
        break;
      case 'display_matched_target':
        table = displayMatchedTarget;
        dateField = displayMatchedTarget.date;
        break;
      case 'display_targeting':
        table = displayTargeting;
        dateField = displayTargeting.date;
        break;
      default:
        continue;
    }
    
    // Use SQL casting for TEXT date columns to ensure proper date comparison
    const conditions = [];
    if (needsCasting) {
      conditions.push(sql`${dateField}::date >= ${from}::date`);
      conditions.push(sql`${dateField}::date <= ${to}::date`);
    } else {
      conditions.push(gte(dateField, from));
      conditions.push(lte(dateField, to));
    }
    if (country && table.country) conditions.push(eq(table.country, country));
    
    // Cast date to proper format for grouping - ensures consistent YYYY-MM-DD format
    // Use the same expression for both SELECT and GROUP BY to avoid type mismatches
    const dateExpression = needsCasting 
      ? sql`${dateField}::date` 
      : sql`${dateField}::date`;
    
    const dateResults = await db
      .select({
        date: sql<string>`to_char(${dateExpression}, 'YYYY-MM-DD')`,
        count: sql<number>`COUNT(*)`,
      })
      .from(table)
      .where(and(...conditions))
      .groupBy(dateExpression);
    
    const dateMap: Record<string, number> = {};
    let totalRecords = 0;
    
    for (const row of dateResults) {
      const dateStr = row.date?.split('T')[0] || row.date;
      dateMap[dateStr] = Number(row.count);
      totalRecords += Number(row.count);
    }
    
    const datesWithData = Object.keys(dateMap).length;
    const missingDates = allDates.filter(d => !dateMap[d]);
    
    results[tableName] = {
      dates: dateMap,
      totalRecords,
      datesWithData,
      missingDates,
    };
  }
  
  return {
    dateRange: { from, to, totalDays: allDates.length },
    coverage: results,
    summary: Object.entries(results).map(([table, data]) => ({
      table,
      totalRecords: data.totalRecords,
      daysWithData: data.datesWithData,
      missingDays: data.missingDates.length,
      coveragePercent: ((data.datesWithData / allDates.length) * 100).toFixed(1) + '%',
    })),
  };
}

// Get daily breakdown - daily-level metrics for trend analysis
async function executeGetDailyBreakdown(params: { from: string; to: string; country?: string; campaignType?: string; campaignId?: number }) {
  const { from, to, country, campaignType = 'products', campaignId } = params;
  
  let results: any[] = [];
  
  if (campaignType === 'brands') {
    const conditions = [];
    conditions.push(gte(brandSearchTerms.date, from));
    conditions.push(lte(brandSearchTerms.date, to));
    if (country) conditions.push(eq(brandSearchTerms.country, country));
    if (campaignId) conditions.push(eq(brandSearchTerms.campaignId, campaignId));
    
    results = await db
      .select({
        date: brandSearchTerms.date,
        clicks: sql<number>`COALESCE(SUM(${brandSearchTerms.clicks}), 0)`,
        cost: sql<number>`COALESCE(SUM(${brandSearchTerms.cost}), 0)`,
        sales: sql<number>`COALESCE(SUM(${brandSearchTerms.sales}), 0)`,
        orders: sql<number>`COALESCE(SUM(${brandSearchTerms.purchases}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${brandSearchTerms.impressions}), 0)`,
      })
      .from(brandSearchTerms)
      .where(and(...conditions))
      .groupBy(brandSearchTerms.date)
      .orderBy(brandSearchTerms.date);
  } else if (campaignType === 'display') {
    const conditions = [];
    conditions.push(gte(displayMatchedTarget.date, from));
    conditions.push(lte(displayMatchedTarget.date, to));
    if (country) conditions.push(eq(displayMatchedTarget.country, country));
    if (campaignId) conditions.push(eq(displayMatchedTarget.campaignId, campaignId));
    
    results = await db
      .select({
        date: displayMatchedTarget.date,
        clicks: sql<number>`COALESCE(SUM(${displayMatchedTarget.clicks}), 0)`,
        cost: sql<number>`COALESCE(SUM(${displayMatchedTarget.cost}), 0)`,
        sales: sql<number>`COALESCE(SUM(${displayMatchedTarget.sales}), 0)`,
        orders: sql<number>`COALESCE(SUM(${displayMatchedTarget.purchases}), 0)`,
        impressions: sql<number>`COALESCE(SUM(${displayMatchedTarget.impressions}), 0)`,
      })
      .from(displayMatchedTarget)
      .where(and(...conditions))
      .groupBy(displayMatchedTarget.date)
      .orderBy(displayMatchedTarget.date);
  } else {
    // Products table has TEXT date column - need to cast for proper comparison
    const conditions = [];
    conditions.push(sql`${productSearchTerms.date}::date >= ${from}::date`);
    conditions.push(sql`${productSearchTerms.date}::date <= ${to}::date`);
    if (country) conditions.push(eq(productSearchTerms.country, country));
    if (campaignId) conditions.push(eq(productSearchTerms.campaignId, campaignId));
    
    results = await db
      .select({
        date: sql<string>`to_char(${productSearchTerms.date}::date, 'YYYY-MM-DD')`,
        clicks: sql<number>`COALESCE(SUM(${productSearchTerms.clicks}), 0)`,
        cost: sql<number>`COALESCE(SUM(${productSearchTerms.cost}), 0)`,
        sales: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.sales30d}, '')::numeric), 0)`,
        orders: sql<number>`COALESCE(SUM(NULLIF(${productSearchTerms.purchases30d}, '')::numeric), 0)`,
        impressions: sql<number>`COALESCE(SUM(${productSearchTerms.impressions}), 0)`,
      })
      .from(productSearchTerms)
      .where(and(...conditions))
      .groupBy(sql`${productSearchTerms.date}::date`)
      .orderBy(sql`${productSearchTerms.date}::date`);
  }
  
  return results.map(row => ({
    date: String(row.date),
    clicks: Number(row.clicks),
    cost: Number(row.cost),
    sales: Number(row.sales),
    orders: Number(row.orders),
    impressions: Number(row.impressions),
    acos: calculateACOS(Number(row.cost), Number(row.sales)),
    cpc: calculateCPC(Number(row.cost), Number(row.clicks)),
    cvr: calculateCVR(Number(row.orders), Number(row.clicks)),
  }));
}

// Execute tool based on name
async function executeTool(name: string, input: any): Promise<string> {
  try {
    let result: any;
    
    switch (name) {
      case 'get_kpis':
        result = await executeGetKpis(input);
        break;
      case 'get_campaigns':
        result = await executeGetCampaigns(input);
        break;
      case 'get_countries_performance':
        result = await executeGetCountriesPerformance(input);
        break;
      case 'get_top_search_terms':
        result = await executeGetTopSearchTerms(input);
        break;
      case 'get_negative_keyword_candidates':
        result = await executeGetNegativeKeywordCandidates(input);
        break;
      case 'get_product_placements':
        result = await executeGetProductPlacements(input);
        break;
      case 'get_brand_placements':
        result = await executeGetBrandPlacements(input);
        break;
      case 'get_display_targeting':
        result = await executeGetDisplayTargeting(input);
        break;
      case 'get_data_coverage':
        result = await executeGetDataCoverage(input);
        break;
      case 'get_daily_breakdown':
        result = await executeGetDailyBreakdown(input);
        break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    
    return JSON.stringify(result, null, 2);
  } catch (error: any) {
    console.error(`Tool execution error (${name}):`, error);
    return JSON.stringify({ error: error.message });
  }
}

// Main agent query function with agentic loop
export async function queryAgent(userMessage: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage }
  ];
  
  let response = await client.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools,
    messages,
  });
  
  // Agentic loop - keep processing until no more tool calls
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    
    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }
    
    // Add assistant response and tool results to messages
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
    
    // Get next response
    response = await client.messages.create({
      model: "claude-opus-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
  }
  
  // Extract final text response
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  
  return textBlocks.map(block => block.text).join("\n");
}

// Streaming version for real-time responses
export async function* queryAgentStream(userMessage: string): AsyncGenerator<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage }
  ];
  
  let continueLoop = true;
  
  while (continueLoop) {
    const stream = await client.messages.stream({
      model: "claude-opus-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    
    let currentResponse: Anthropic.Message | null = null;
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    
    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if ("text" in delta) {
          yield delta.text;
        }
      } else if (event.type === "message_stop") {
        currentResponse = await stream.finalMessage();
      }
    }
    
    if (!currentResponse) {
      currentResponse = await stream.finalMessage();
    }
    
    // Check if we need to handle tool calls
    if (currentResponse.stop_reason === "tool_use") {
      const toolBlocks = currentResponse.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      
      // Execute tools
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolBlocks) {
        yield `\n\n_Querying ${toolUse.name.replace(/_/g, ' ')}..._\n\n`;
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }
      
      // Add to messages for next iteration
      messages.push({ role: "assistant", content: currentResponse.content });
      messages.push({ role: "user", content: toolResults });
    } else {
      continueLoop = false;
    }
  }
}
