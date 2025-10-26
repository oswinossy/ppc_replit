# Elan - Amazon PPC Analytics Portal

## Overview
Internal analytics portal for Amazon PPC campaigns combining **Sponsored Products**, **Sponsored Brands**, and **Display** campaign data with bid recommendations targeting 20% ACOS.

## Tech Stack
- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, Wouter
- **Backend**: Express, Drizzle ORM, PostgreSQL (Supabase)
- **Database**: Supabase PostgreSQL with 6 tables across 3 campaign types

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
- **Campaign Type Segmentation**: 6-view system - 3 campaign types (Sponsored Products, Sponsored Brands, Display) × 2 views (Search Terms, Placements)
- **EUR Currency Conversion**: All metrics displayed in EUR using daily ECB exchange rates
- **Placement Analysis**: Campaign-level placement performance (TOS, ROS, PP, UNKNOWN)
- **KPI Tracking**: Sales, ACOS, CPC, Cost, CVR, Orders
- **Performance Charts**: Weekly aggregated ACOS and sales trends
- **Bid Recommendations**: 20% ACOS targeting with confidence levels (shown for ALL search terms)
- **Negative Keywords**: Auto-detection with ≥20 clicks, $0 sales
- **Excel Export**: Download negative keywords for bulk upload

### Campaign Type Segmentation (6-View System)
The Ad Group view provides a campaign type selector allowing users to view data segmented by Amazon campaign type:

**3 Campaign Types:**
1. **Sponsored Products** (default): Search ads targeting products
2. **Sponsored Brands**: Brand awareness campaigns
3. **Display**: Display advertising campaigns

**2 Views per Campaign Type:**
1. **Search Terms**: Keyword/targeting performance with bid recommendations
2. **Placements**: Placement type performance (TOS, ROS, PP, etc.)

**Implementation Details:**
- Campaign type selector updates URL with `?campaignType=products|brands|display` parameter
- View toggle switches between Search Terms and Placements
- All API endpoints (`/api/kpis`, `/api/search-terms`, `/api/placements`) accept `campaignType` parameter
- **Critical**: Products campaign type filters by `adGroupId`; Brands and Display do NOT use adGroupId filter (those tables don't have this field)
- Display campaigns use `targetingText` instead of `searchTerm` and `matchedTargetAsin` instead of `keyword`

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

### Currency Conversion System
- **Automatic EUR Conversion**: All sales, costs, and derived metrics displayed in EUR
- **Daily Exchange Rates**: Uses Frankfurter API (European Central Bank rates)
- **Supported Currencies**: EUR, USD, GBP, SEK, PLN
- **Date Handling**: Future dates use latest available rates, historical dates use exact daily rates
- **Conversion Logic**:
  1. Query data grouped by country, date, and currency
  2. Fetch ECB exchange rates for each unique date
  3. Convert cost/sales to EUR: `eurValue = originalValue × toEurRate`
  4. Aggregate all countries in EUR
- **API**: Free Frankfurter API (no API key required, no rate limits)

### Date Range Filtering
- **Preset Periods**: 7D, 14D, 30D, 60D, 90D buttons for quick selection
- **Custom Date Picker**: Two-month calendar view for arbitrary date ranges
- **Dynamic Labels**: Period chip updates to show "Last X days" or custom date range
- **Auto-Refresh**: All API endpoints automatically refetch when date range changes
- **Default Period**: 60 days (Last 60 days)

### Navigation
- Sticky header with branding and export
- Breadcrumb navigation
- URL-persisted filters
- Click-through drilldown tables

## Data Structure

### Brand Tables (Clean Numeric Types)

**1. `s_brand_search_terms` (8,228 rows)**
- Performance Metrics (numeric types): `clicks`, `cost`, `sales`, `purchases`, `keywordBid`
- Identifiers: `campaignId`, `adGroupId`, `keywordId` (bigint)
- Metadata: `searchTerm`, `keywordText`, `matchType`, `campaignBudgetCurrencyCode`, `country`, `date`

**2. `s_brand_placment` (typo in actual table name - 1,394 rows)**
- Performance Metrics (numeric types): `clicks`, `cost`, `sales`, `purchases`
- Identifiers: `campaignId`, `campaignName`
- Metadata: `campaignPlacement` (TOS/ROS/PP/UNKNOWN), `country`, `date`

### Product Tables (TEXT-based Metrics)

**3. `s_products_search_terms` (47,211 rows)**
- Performance Metrics (TEXT - requires casting):
  - `clicks`, `cost` (can be used directly as numbers)
  - `sales7d`, `sales14d`, `purchases7d`, `purchases14d` (TEXT - must cast)
- Identifiers: `campaignId`, `adGroupId`, `keywordId` (bigint)
- Metadata: `searchTerm`, `keyword`, `matchType`, `campaignBudgetCurrencyCode`, `country`, `date`

**Important Note:** Product table sales/purchases are TEXT and must be cast:
```sql
COALESCE(SUM(NULLIF(sales7d, '')::numeric), 0)
```

**4. `s_products_placement` (placeholder - use sp_placement_daily_v2)**

### Display Tables

**5. `s_display_matched_target` (Display Search Terms equivalent)**
- Performance Metrics (numeric types): `clicks`, `cost`, `sales`, `purchases`
- Identifiers: `campaignId`, `adGroupId`, `keywordId` (bigint)
- Metadata: `targetingText` (equivalent to searchTerm), `matchedTargetAsin`, `campaignBudgetCurrencyCode`, `country`, `date`

**6. `s_display_targeting` (Display Placements equivalent)**
- Performance Metrics (numeric types): `clicks`, `cost`, `sales`, `purchases`
- Identifiers: `campaignId`, `adGroupId`
- Metadata: `targetingText`, `targetingExpression`, `campaignBudgetCurrencyCode`, `country`, `date`

### Legacy Placements Table
`sp_placement_daily_v2` (47 columns, 30,231 rows):
- All metrics are TEXT and require casting
- Contains historical product placement data

## API Architecture

### Campaign Type Filtering Strategy
All API endpoints filter by `campaignType` parameter (defaults to 'products'):

**Filtering Logic:**
- **Sponsored Products**: Queries `s_products_search_terms` and `s_products_placement` tables, filters by `adGroupId`
- **Sponsored Brands**: Queries `s_brand_search_terms` and `s_brand_placment` tables, NO adGroupId filter (brand tables don't use this field)
- **Display**: Queries `s_display_matched_target` and `s_display_targeting` tables, NO adGroupId filter (display tables don't use this field)

**Important Implementation Note:**
The `adGroupId` filter is ONLY applied to Sponsored Products queries. Brands and Display campaign types ignore the adGroupId parameter to avoid filtering out all rows (those tables don't have an adGroupId field that matches the products adGroupId structure).

### Critical Fields in API Responses
- **Always include calculated fields**: `cpc`, `cvr`, `acos`
- **Frontend safety**: All numeric renders use null guards: `(val ?? 0).toFixed(2)`

Example response structure:
```typescript
{
  searchTerm: string,
  clicks: number,
  cost: number,
  sales: number,
  orders: number,
  acos: number,
  cpc: number,  // cost / clicks
  cvr: number,  // (orders / clicks) * 100
  currentBid: number,
  recommendedBid: number,
  currency: string
}
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
- **2025-10-26**: ✅ Implemented 6-view campaign type segmentation system
  - Added Display table schemas (s_display_matched_target, s_display_targeting) to shared/schema.ts
  - Updated AdGroupView.tsx with campaign type selector (Sponsored Products | Sponsored Brands | Display)
  - Refactored 3 core API endpoints (/api/kpis, /api/search-terms, /api/placements) to filter by campaignType parameter
  - Fixed adGroupId filtering: Only applies to Products, removed from Brands/Display queries (those tables don't have this field)
  - Fixed numeric type conversion to prevent .toFixed() errors
  - Added € currency symbol to all Cost and Sales columns in frontend tables
  - E2E tested all 6 views (3 campaign types × 2 views) successfully
- **2025-10-17**: ✅ Implemented functional date range filtering
  - Added working preset periods (7D, 14D, 30D, 60D, 90D)
  - Implemented Custom date picker with two-month calendar view
  - Dynamic period labels update based on selection
  - All API endpoints automatically refetch data when date range changes
  - Verified with e2e tests: 30D shows €149k, 90D shows €159k
- **2025-10-17**: ✅ Implemented EUR currency conversion using daily ECB exchange rates
  - Created exchange rate utility using Frankfurter API (free, no key required)
  - Updated all API endpoints (KPIs, countries, chart-data) to convert to EUR
  - Handles future dates by using latest available rates
  - All dashboard metrics now displayed in EUR with proper aggregation
- **2025-10-17**: ✅ Added "Bid Recommendation" column to search terms table
  - Shows recommended bids for ALL search terms (not just 30+ clicks)
  - Inline display in main table for easy comparison with current bids
  - Uses PPC AI logic: increase for ACOS <16%, decrease for ACOS >20%
- **2025-10-17**: ✅ Fixed CPC/CVR rendering bug - added calculated fields to API response
- **2025-10-17**: ✅ Added null guards to all toFixed() calls in frontend
- **2025-10-17**: ✅ E2E tests passing - €157k sales, 22% ACOS (combined brand + product)
- **2025-10-17**: ✅ Migrated from 2-table to 4-table structure combining brand + product
- **2025-10-17**: ✅ Rewrote all API routes using UNION queries for combined data
- 2025-10-14: ✅ Integrated sp_placement_daily_v2 table (30k+ rows)
- 2025-10-14: ✅ Successfully connected to Supabase database using pooler
- 2025-10-11: Implemented bid recommendation engine
- 2025-10-11: Integrated Excel export for negatives

## Known Issues & Limitations
- Timezone normalization assumes UTC (monitor for drift if deploying outside UTC)
- Some placement rows show "UNKNOWN" type (actual placement type may need mapping)
- Table name typo: `s_brand_placment` (missing 'e' in placement) - actual database name

## User Preferences
- Prefer data-first over decorative UI
- M19.com-inspired clean design
- Professional color scheme

## Data Volume Summary
- **Brand Search Terms**: 8,228 rows
- **Brand Placements**: 1,394 rows
- **Product Search Terms**: 47,211 rows
- **Total Combined**: €167,833 sales across 10 countries
