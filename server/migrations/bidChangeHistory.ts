import { db } from "../db";
import { sql } from "drizzle-orm";

export async function createBidChangeHistoryTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bid_change_history (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        campaign_type TEXT NOT NULL,
        targeting TEXT NOT NULL,
        campaign_id BIGINT NOT NULL,
        ad_group_id BIGINT,
        campaign_name TEXT,
        ad_group_name TEXT,
        country TEXT,
        date_adjusted DATE NOT NULL,
        current_bid NUMERIC NOT NULL,
        previous_bid NUMERIC NOT NULL,
        match_type TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS bid_history_targeting_campaign_idx 
      ON bid_change_history(targeting, campaign_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS bid_history_date_idx 
      ON bid_change_history(date_adjusted)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS bid_history_campaign_type_idx
      ON bid_change_history(campaign_type)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS bid_history_campaign_country_idx
      ON bid_change_history(campaign_id, country)
    `);

    console.log('✓ bid_change_history table created/verified');
  } catch (error) {
    console.error('Error creating bid_change_history table:', error);
    throw error;
  }
}
