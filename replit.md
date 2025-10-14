# Elan - Amazon PPC Analytics Portal

## Overview
Internal analytics portal for Amazon PPC campaigns with bid recommendations targeting 20% ACOS.

## Tech Stack
- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, Wouter
- **Backend**: Express, Drizzle ORM, PostgreSQL (Supabase)
- **Database**: Supabase PostgreSQL with tables `s_products_searchterms` and `sp_placement_daily_v2`

## Setup Instructions

### 1. Database Setup (Completed ✅)
Connected to Supabase database successfully using pooler connection.

**Connection String Format:**
```
postgresql://postgres.{PROJECT_REF}:{PASSWORD}@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

Note: The pooler hostname is required for Replit network access.

### 2. Environment Variables
Required secrets (configured):
- `DATABASE_URL` - Supabase pooler connection string
- `SESSION_SECRET` - Session encryption key

### 3. Running the App
```bash
npm run dev
```

The app will be available on port 5000.

## Features

### Core Features
- **Multi-level Drilldown**: Dashboard → Countries → Campaigns → Ad Groups → Search Terms
- **Placement Analysis**: Campaign-level placement performance (TOS, ROS, PP, UNKNOWN)
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

### Main Table
`s_products_searchterms` (64 columns total):

**Performance Metrics:**
- Numeric: `impressions`, `clicks` (bigint), `cost`, `costPerClick`, `keywordBid` (double precision)
- TEXT (requires casting): `sales7d`, `sales14d`, `purchases7d`, `purchases14d`, `acosClicks7d`, `roasClicks7d`

**Identifiers:**
- `campaignId`, `adGroupId`, `keywordId` (bigint)
- `searchTerm`, `targeting`, `keyword` (text)

**Metadata:**
- `country`, `campaignName`, `adGroupName`, `matchType`, `keywordType` (text)
- `campaignBudgetCurrencyCode` (EUR, GBP, SEK, PLN)
- `date` (text format: YYYY-MM-DD)

**Important Note:** Sales and purchases columns are stored as TEXT and must be cast to numeric for aggregation:
```sql
COALESCE(SUM(NULLIF(sales7d, '')::numeric), 0)
```

### Placements Table
`sp_placement_daily_v2` (47 columns, 30,231 rows):

**Performance Metrics (all TEXT - require casting):**
- `impressions`, `clicks`, `cost`, `spend`, `costPerClick`, `clickThroughRate`
- Sales: `sales1d`, `sales7d`, `sales14d`, `sales30d`
- Purchases: `purchases1d`, `purchases7d`, `purchases14d`, `purchases30d`
- Units sold: `unitsSoldClicks1d/7d/14d/30d`
- ACOS/ROAS: `acosClicks14d`, `roasClicks14d`

**Identifiers:**
- `campaignId` (bigint), `campaignName` (text)
- `campaignPlacement` (text) - TOS/ROS/PP/UNKNOWN
- `country` (text), `date` (text)

**Important Note:** All metrics are TEXT and must be cast using:
```sql
COALESCE(SUM(NULLIF(column, '')::numeric), 0)
```

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
- 2025-10-14: ✅ Integrated sp_placement_daily_v2 table (30k+ rows)
- 2025-10-14: ✅ Updated placements endpoint with TEXT column casting
- 2025-10-14: ✅ E2E tests passed - Placements tab working with real data
- 2025-10-14: ✅ Successfully connected to Supabase database using pooler
- 2025-10-14: ✅ Updated schema to match actual table structure (TEXT columns for sales/purchases)
- 2025-10-14: ✅ Fixed all API routes to handle TEXT to numeric conversions
- 2025-10-14: ✅ Verified full drilldown flow works with real data (10 countries, €95k sales)
- 2025-10-11: Implemented bid recommendation engine
- 2025-10-11: Integrated Excel export for negatives

## Known Issues & Limitations
- Date range picker currently shows static "Last 60 days"
- Timezone normalization assumes UTC (monitor for drift if deploying outside UTC)
- Some placement rows show "UNKNOWN" type (actual placement type may need mapping)

## User Preferences
- Prefer data-first over decorative UI
- M19.com-inspired clean design
- Professional color scheme
