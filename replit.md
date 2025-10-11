# Elan - Amazon PPC Analytics Portal

## Overview
Internal analytics portal for Amazon PPC campaigns with bid recommendations targeting 20% ACOS.

## Tech Stack
- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, Wouter
- **Backend**: Express, Drizzle ORM, PostgreSQL (Supabase)
- **Database**: Supabase PostgreSQL with views `vw_sp_search_terms_daily` and `sp_placement_daily_v2`

## Setup Instructions

### 1. Database Setup (Required)
Your Supabase table has hyphens in the name which causes issues with Drizzle ORM. You need to create a view:

1. Go to your Supabase dashboard → SQL Editor
2. Run the SQL from `supabase-setup.sql`:
```sql
CREATE OR REPLACE VIEW vw_sp_search_terms_daily AS 
SELECT * FROM "sp_search_terms_daily_from22-09-2025";
```

### 2. Environment Variables
Required secrets (already configured):
- `DATABASE_URL` - Supabase connection string
- `SESSION_SECRET` - Session encryption key

### 3. Running the App
```bash
npm run dev
```

The app will be available on port 5000.

## Features

### Core Features
- **Multi-level Drilldown**: Dashboard → Countries → Campaigns → Ad Groups → Search Terms
- **KPI Tracking**: Sales, ACOS, CPC, Cost, ROAS, Orders
- **Performance Charts**: Weekly aggregated ACOS and sales trends
- **Bid Recommendations**: 20% ACOS targeting with confidence levels
- **Negative Keywords**: Auto-detection with ≥20 clicks, $0 sales
- **Excel Export**: Download negative keywords for bulk upload

### Recommendation Engine
- **Confidence Levels**:
  - Extreme: 1000+ clicks
  - High: 300-999 clicks  
  - Good: 100-299 clicks
  - OK: 30-99 clicks
  - Low: <30 clicks (not shown)

- **Bid Adjustments**:
  - No sales: -15% to -30% based on CPC
  - ACOS <16%: +10% to +20% (scale with data)
  - Standard: ACOS-based optimization
  - Safeguards: 20%-150% of base bid

### Navigation
- Sticky header with branding and export
- Breadcrumb navigation
- URL-persisted filters
- Click-through drilldown tables

## Data Structure

### Main Table (via View)
`vw_sp_search_terms_daily` columns:
- Performance: clicks, cost, sales7d, purchases7d
- Identifiers: campaignId, adGroupId, searchTerm
- Metadata: country, matchType, keywordBid, currency, dt

### Placements Table
`sp_placement_daily_v2`: TOS, ROS, PP performance

## Design Guidelines
- Professional data-focused aesthetic (Linear + Vercel inspired)
- Dark mode primary with theme toggle
- Color-coded ACOS badges:
  - Green: <20%
  - Amber: 20-30%
  - Red: >30%
- Inter font family
- Responsive grid layouts

## Recent Changes
- 2025-10-11: Connected to real Supabase data via view workaround
- 2025-10-11: Implemented full drilldown navigation
- 2025-10-11: Added bid recommendation engine
- 2025-10-11: Integrated Excel export for negatives

## Known Issues
- Table name contains hyphens - resolved via database view
- Date range picker currently shows static "Last 60 days"

## User Preferences
- Prefer data-first over decorative UI
- M19.com-inspired clean design
- Professional color scheme
