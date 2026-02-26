import postgres from "postgres";

export async function createWeightConfigTable(): Promise<void> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "s_weight_config" (
        id SERIAL PRIMARY KEY,
        country TEXT NOT NULL DEFAULT 'ALL',
        t0_weight NUMERIC NOT NULL DEFAULT 0.35,
        d30_weight NUMERIC NOT NULL DEFAULT 0.25,
        d365_weight NUMERIC NOT NULL DEFAULT 0.25,
        lifetime_weight NUMERIC NOT NULL DEFAULT 0.15,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(country)
      )
    `;
    
    // Insert global default if not exists
    await sql`
      INSERT INTO "s_weight_config" (country, t0_weight, d30_weight, d365_weight, lifetime_weight)
      VALUES ('ALL', 0.35, 0.25, 0.25, 0.15)
      ON CONFLICT (country) DO NOTHING
    `;
    
    console.log('s_weight_config table created/verified with global defaults');
  } finally {
    await sql.end();
  }
}

export async function createRecommendationHistoryTable(): Promise<void> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "s_recommendation_history" (
        id SERIAL PRIMARY KEY,
        country TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT,
        ad_group_id TEXT,
        ad_group_name TEXT,
        targeting TEXT NOT NULL,
        match_type TEXT,
        recommendation_type TEXT NOT NULL,
        placement TEXT,
        linked_group_id TEXT,
        old_value NUMERIC,
        recommended_value NUMERIC,
        pre_acos_t0 NUMERIC,
        pre_acos_30d NUMERIC,
        pre_acos_365d NUMERIC,
        pre_acos_lifetime NUMERIC,
        pre_clicks_t0 INTEGER,
        pre_clicks_30d INTEGER,
        pre_clicks_365d INTEGER,
        pre_clicks_lifetime INTEGER,
        pre_cost_t0 NUMERIC,
        pre_cost_30d NUMERIC,
        pre_cost_365d NUMERIC,
        pre_cost_lifetime NUMERIC,
        pre_orders_t0 NUMERIC,
        pre_orders_30d NUMERIC,
        pre_orders_365d NUMERIC,
        pre_orders_lifetime NUMERIC,
        weighted_acos NUMERIC,
        acos_target NUMERIC,
        confidence TEXT,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        implemented_at TIMESTAMP,
        post_acos_14d NUMERIC,
        post_acos_30d NUMERIC,
        success_score NUMERIC
      )
    `;
    
    // Create indexes for common queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_rec_history_country ON "s_recommendation_history" (country)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_rec_history_campaign ON "s_recommendation_history" (campaign_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_rec_history_linked_group ON "s_recommendation_history" (linked_group_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_rec_history_created ON "s_recommendation_history" (created_at DESC)
    `;
    
    console.log('s_recommendation_history table created/verified with indexes');
    
    // Add new columns if they don't exist (for existing tables)
    // Using NUMERIC for orders as source data may have decimals due to aggregation
    const newColumns = [
      'pre_cost_t0 NUMERIC',
      'pre_cost_30d NUMERIC',
      'pre_cost_365d NUMERIC',
      'pre_cost_lifetime NUMERIC',
      'pre_orders_t0 NUMERIC',
      'pre_orders_30d NUMERIC',
      'pre_orders_365d NUMERIC',
      'pre_orders_lifetime NUMERIC'
    ];
    
    for (const col of newColumns) {
      const colName = col.split(' ')[0];
      try {
        await sql`ALTER TABLE "s_recommendation_history" ADD COLUMN IF NOT EXISTS ${sql.unsafe(col)}`;
      } catch (e: any) {
        // Column may already exist
        if (!e.message?.includes('already exists')) {
          console.log(`Note: Column ${colName} may already exist`);
        }
      }
    }
    
    // Ensure orders columns are NUMERIC (fix for INTEGER columns that need to store decimals)
    const ordersColumns = ['pre_orders_t0', 'pre_orders_30d', 'pre_orders_365d', 'pre_orders_lifetime'];
    for (const colName of ordersColumns) {
      try {
        await sql`ALTER TABLE "s_recommendation_history" ALTER COLUMN ${sql.unsafe(colName)} TYPE NUMERIC USING ${sql.unsafe(colName)}::NUMERIC`;
      } catch (e: any) {
        // Column may already be NUMERIC
        console.log(`Note: Column ${colName} type check: ${e.message?.substring(0, 50)}`);
      }
    }
    console.log('s_recommendation_history new columns verified');
  } finally {
    await sql.end();
  }
}

export async function getWeightsForCountry(country: string): Promise<{
  t0_weight: number;
  d30_weight: number;
  d365_weight: number;
  lifetime_weight: number;
}> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    // Try country-specific first, then fall back to global
    const result = await sql`
      SELECT t0_weight, d30_weight, d365_weight, lifetime_weight 
      FROM "s_weight_config"
      WHERE country = ${country}
      UNION ALL
      SELECT t0_weight, d30_weight, d365_weight, lifetime_weight 
      FROM "s_weight_config"
      WHERE country = 'ALL'
      LIMIT 1
    `;
    
    if (result.length > 0) {
      return {
        t0_weight: Number(result[0].t0_weight),
        d30_weight: Number(result[0].d30_weight),
        d365_weight: Number(result[0].d365_weight),
        lifetime_weight: Number(result[0].lifetime_weight)
      };
    }
    
    // Default fallback
    return { t0_weight: 0.35, d30_weight: 0.25, d365_weight: 0.25, lifetime_weight: 0.15 };
  } finally {
    await sql.end();
  }
}

export async function updateWeightsForCountry(
  country: string,
  weights: { t0_weight: number; d30_weight: number; d365_weight: number; lifetime_weight: number }
): Promise<void> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    await sql`
      INSERT INTO "s_weight_config" (country, t0_weight, d30_weight, d365_weight, lifetime_weight, updated_at)
      VALUES (${country}, ${weights.t0_weight}, ${weights.d30_weight}, ${weights.d365_weight}, ${weights.lifetime_weight}, NOW())
      ON CONFLICT (country) DO UPDATE SET
        t0_weight = EXCLUDED.t0_weight,
        d30_weight = EXCLUDED.d30_weight,
        d365_weight = EXCLUDED.d365_weight,
        lifetime_weight = EXCLUDED.lifetime_weight,
        updated_at = NOW()
    `;
  } finally {
    await sql.end();
  }
}

export async function saveRecommendation(rec: {
  country: string;
  campaign_id: string;
  campaign_name?: string;
  ad_group_id?: string;
  ad_group_name?: string;
  targeting: string;
  match_type?: string;
  recommendation_type: string;
  placement?: string;
  linked_group_id?: string;
  old_value?: number;
  recommended_value?: number;
  pre_acos_t0?: number;
  pre_acos_30d?: number;
  pre_acos_365d?: number;
  pre_acos_lifetime?: number;
  pre_clicks_t0?: number;
  pre_clicks_30d?: number;
  pre_clicks_365d?: number;
  pre_clicks_lifetime?: number;
  pre_cost_t0?: number;
  pre_cost_30d?: number;
  pre_cost_365d?: number;
  pre_cost_lifetime?: number;
  pre_orders_t0?: number;
  pre_orders_30d?: number;
  pre_orders_365d?: number;
  pre_orders_lifetime?: number;
  weighted_acos?: number;
  acos_target?: number;
  confidence?: string;
  reason?: string;
}): Promise<number> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    const result = await sql`
      INSERT INTO "s_recommendation_history" (
        country, campaign_id, campaign_name, ad_group_id, ad_group_name,
        targeting, match_type, recommendation_type, placement, linked_group_id,
        old_value, recommended_value, pre_acos_t0, pre_acos_30d, pre_acos_365d,
        pre_acos_lifetime, pre_clicks_t0, pre_clicks_30d, pre_clicks_365d, pre_clicks_lifetime,
        pre_cost_t0, pre_cost_30d, pre_cost_365d, pre_cost_lifetime,
        pre_orders_t0, pre_orders_30d, pre_orders_365d, pre_orders_lifetime,
        weighted_acos, acos_target, confidence, reason
      )
      VALUES (
        ${rec.country}, ${rec.campaign_id}, ${rec.campaign_name || null}, ${rec.ad_group_id || null}, ${rec.ad_group_name || null},
        ${rec.targeting}, ${rec.match_type || null}, ${rec.recommendation_type}, ${rec.placement || null}, ${rec.linked_group_id || null},
        ${rec.old_value ?? null}, ${rec.recommended_value ?? null}, ${rec.pre_acos_t0 ?? null}, ${rec.pre_acos_30d ?? null}, ${rec.pre_acos_365d ?? null},
        ${rec.pre_acos_lifetime ?? null}, ${rec.pre_clicks_t0 ?? null}, ${rec.pre_clicks_30d ?? null}, ${rec.pre_clicks_365d ?? null}, ${rec.pre_clicks_lifetime ?? null},
        ${rec.pre_cost_t0 ?? null}, ${rec.pre_cost_30d ?? null}, ${rec.pre_cost_365d ?? null}, ${rec.pre_cost_lifetime ?? null},
        ${rec.pre_orders_t0 ?? null}, ${rec.pre_orders_30d ?? null}, ${rec.pre_orders_365d ?? null}, ${rec.pre_orders_lifetime ?? null},
        ${rec.weighted_acos ?? null}, ${rec.acos_target ?? null}, ${rec.confidence || null}, ${rec.reason || null}
      )
      RETURNING id
    `;
    return result[0].id;
  } finally {
    await sql.end();
  }
}

export async function markRecommendationImplemented(id: number): Promise<void> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    await sql`
      UPDATE "s_recommendation_history"
      SET implemented_at = NOW()
      WHERE id = ${id}
    `;
  } finally {
    await sql.end();
  }
}

export async function getRecommendationHistory(filters: {
  country?: string;
  campaign_id?: string;
  implemented_only?: boolean;
  limit?: number;
}): Promise<any[]> {
  const connectionUrl = (process.env.DATABASE_URL || '').replace(/[\r\n\t]/g, '').trim().replace(/\s+/g, '');
  const sql = postgres(connectionUrl);
  
  try {
    let query = sql`
      SELECT * FROM "s_recommendation_history"
      WHERE 1=1
    `;
    
    // Build dynamic query based on filters
    if (filters.country) {
      query = sql`
        SELECT * FROM "s_recommendation_history"
        WHERE country = ${filters.country}
        ${filters.campaign_id ? sql`AND campaign_id = ${filters.campaign_id}` : sql``}
        ${filters.implemented_only ? sql`AND implemented_at IS NOT NULL` : sql``}
        ORDER BY created_at DESC
        LIMIT ${filters.limit || 100}
      `;
    } else {
      query = sql`
        SELECT * FROM "s_recommendation_history"
        WHERE 1=1
        ${filters.campaign_id ? sql`AND campaign_id = ${filters.campaign_id}` : sql``}
        ${filters.implemented_only ? sql`AND implemented_at IS NOT NULL` : sql``}
        ORDER BY created_at DESC
        LIMIT ${filters.limit || 100}
      `;
    }
    
    return await query;
  } finally {
    await sql.end();
  }
}
