-- Create a view to work around Drizzle ORM issues with hyphenated table names
-- Run this SQL in your Supabase SQL Editor:

CREATE OR REPLACE VIEW vw_sp_search_terms_daily AS 
SELECT * FROM "sp_search_terms_daily_from22-09-2025";

-- Optionally, create a similar view for placements if needed:
-- CREATE OR REPLACE VIEW vw_sp_placement_daily AS 
-- SELECT * FROM sp_placement_daily_v2;
