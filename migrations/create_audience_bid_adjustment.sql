-- Migration: Create audience_bid_adjustment table
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

CREATE TABLE IF NOT EXISTS audience_bid_adjustment (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  campaign_status TEXT,
  segment_name TEXT,
  segment_class_code TEXT,
  audience_id TEXT,
  bid_adjustment_pct BIGINT,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0,
  cost_per_click NUMERIC(8,4),
  click_through_rate NUMERIC(8,6),
  purchases_7d BIGINT DEFAULT 0,
  sales_7d NUMERIC(12,2) DEFAULT 0,
  purchases_14d BIGINT DEFAULT 0,
  sales_14d NUMERIC(12,2) DEFAULT 0,
  report_start_date DATE,
  report_end_date DATE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(country, campaign_id, segment_name, report_start_date, report_end_date)
);

CREATE INDEX IF NOT EXISTS aud_bid_adj_country_date_idx
  ON audience_bid_adjustment (country, report_start_date);
CREATE INDEX IF NOT EXISTS aud_bid_adj_campaign_idx
  ON audience_bid_adjustment (campaign_id);

-- Grant access
GRANT ALL ON audience_bid_adjustment TO service_role;
GRANT ALL ON audience_bid_adjustment TO authenticated;
GRANT SELECT ON audience_bid_adjustment TO anon;
