import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { brandSearchTerms, productSearchTerms, displayMatchedTarget } from "@shared/schema";
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
    model: "claude-sonnet-4-20250514",
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
      model: "claude-sonnet-4-20250514",
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
      model: "claude-sonnet-4-20250514",
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
