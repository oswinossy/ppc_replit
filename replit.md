# Elan - Amazon PPC Analytics Portal

## Overview
Elan is an internal analytics portal designed to centralize and analyze Amazon PPC campaign data (Sponsored Products, Sponsored Brands, Display). Its primary purpose is to provide multi-level drilldown capabilities, KPI tracking, and bid recommendations targeting a 20% ACOS to optimize campaign performance and drive sales growth. The system supports multi-currency display with EUR conversion and offers tools for negative keyword detection and export.

## User Preferences
- Prefer data-first over decorative UI
- M19.com-inspired clean design
- Professional color scheme

## System Architecture

### UI/UX Decisions
- Professional, data-focused aesthetic (Linear + Vercel inspired).
- Dark mode primary with theme toggle.
- Color-coded ACOS badges: Green (<20%), Amber (20-30%), Red (>30%).
- Inter font family.
- Responsive grid layouts.
- Sticky header with branding and export functionality.
- Breadcrumb navigation and URL-persisted filters.
- Click-through drilldown tables for navigation.
- **Campaign Type Filter**: Dashboard-level toggle (Sponsored Products, Sponsored Brands, Display) filters all metrics including country-level performance.

### Technical Implementations
- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, Wouter.
- **Backend**: Express, Drizzle ORM, PostgreSQL (Supabase).
- **Performance Optimizations**:
    - **Frontend**: DateRange auto-initializes to last 60 days on mount to trigger immediate data loading
    - **API Response Caching**: 2-minute TTL in-memory cache for /api/kpis, /api/countries, /api/chart-data endpoints
    - **Exchange Rate Caching**: 5-minute TTL for Frankfurter API responses
    - **Database Indexes**: Composite indexes on (date, country, campaignId) for all fact tables (brand_search_terms, product_search_terms, display_matched_target)
    - **Performance Results**: First load ~1.3-1.6s (down from 4-5s), cached loads ~395ms
- **Core Features**:
    - **Multi-level Drilldown**: Dashboard → Countries → Campaigns → Ad Groups → Search Terms.
    - **Campaign Type Segmentation**: Dashboard-level filter allows switching between Sponsored Products, Sponsored Brands, and Display to analyze performance by campaign type.
    - **EUR Currency Conversion**: All metrics displayed in EUR using daily ECB exchange rates; country-specific views show local currency.
    - **Placement Analysis**: Campaign-level performance by placement type (TOS, ROS, PP, UNKNOWN).
    - **KPI Tracking**: Sales, ACOS, CPC, Cost, CVR, Orders.
    - **Attribution Window**: Sponsored Products uses 30-day attribution (sales30d, purchases30d) to match Amazon's default dashboard view.
    - **Performance Charts**: Weekly aggregated ACOS and sales trends.
    - **Bid Recommendations**: 20% ACOS targeting for all search terms with confidence levels.
    - **Negative Keywords**: Auto-detection (≥20 clicks, $0 sales) with Excel export.
    - **Date Range Filtering**: Preset periods (7D, 14D, 30D, 60D, 90D) and custom date picker with auto-refresh.

### Feature Specifications
- **Campaign-Level Placement Bid Adjustments**: Percentage modifiers (not absolute bids) targeting 20% ACOS, scaled by click volume (confidence).
    - ACOS ≤ 16%: +10% to +20% increase.
    - ACOS > 20%: Formula-based decrease, capped at -50%.
    - ACOS 16-20%: Small adjustments (-10% to +10%).
    - No sales (≥30 clicks): -25% decrease.
- **Recommendation Engine**: Provides bid adjustments based on ACOS and sales data, with safeguards (20%-150% of base bid). Confidence levels (Extreme, High, Good, OK) are based on click volume.
- **Currency Conversion System**:
    - **Dashboard**: All metrics displayed in EUR with full conversion from all currencies (USD, GBP, SEK, PLN, JPY) using daily ECB exchange rates.
    - **Country Views**: Metrics displayed in local currency (USD for US, GBP for GB, SEK for SE, PLN for PL, JPY for JP, EUR for DE/FR/etc).
    - **Currency Preservation**: Navigation preserves currency throughout drill-down chain (Dashboard → Country → Campaign → Ad Group).
    - **Currency Symbols**: Visual indicators display £, $, kr, zł, ¥, € symbols in country-specific views via CurrencyBadge component.
    - **API Support**: All endpoints (`/api/kpis`, `/api/chart-data`, `/api/campaigns`, `/api/search-terms`) support `convertToEur` parameter.
    - **Multi-Currency Guards**: Backend validates single-currency aggregation when `convertToEur=false` to prevent mixing USD+GBP+etc.
    - **Exchange Rates**: Uses Frankfurter API (api.frankfurter.app - European Central Bank) for daily rates with batch date-range support.
    - **Performance Optimization**: Single batch API call via `getExchangeRatesForRange()` replaces 60+ sequential calls, achieving **16-17x speedup** (22s → 1.4s).
    - **Country-to-Currency Mapping**: `productPlacement` table lacks currency field; uses `getCurrencyForCountry()` helper to map country codes to currencies.
    - **Fallback Rates**: When API lacks data (e.g., future dates), silently uses default rates (USD: 0.92, GBP: 1.17, SEK: 0.088, PLN: 0.23 EUR).
    - **Frontend Integration**: Centralized `useSearchParams` hook extracts country query parameter; views conditionally pass `convertToEur=false`.
    - **URL Parameters**: Country code propagated via `?country=` query parameter; enables currency persistence across drill-down.

### System Design Choices
- **Database**: Supabase PostgreSQL with 6 tables across 3 campaign types.
- **Data Structure**:
    - Separate tables for Brand, Product, and Display campaigns.
    - Brand tables (`s_brand_search_terms`, `s_brand_placment`) have numeric metrics.
    - Product tables (`s_products_search_terms`, `s_products_placement`) have TEXT-based sales/purchases requiring casting.
    - Display tables (`s_display_matched_target`, `s_display_targeting`) have numeric metrics.
    - `s_brand_placment` contains a typo in the table name.
    - `s_products_placement` contains `placementClassification` column with Amazon placement types.
    - Display campaigns use `targetingText` instead of `searchTerm` and `matchedTargetAsin` instead of `keyword`.
    - **Placement Classification**: Database stores raw values ("Top of Search on-Amazon", "Detail Page on-Amazon", "Other on-Amazon", "Off Amazon") which are normalized to Amazon UI terminology ("Top of search (first page)", "Product pages", "Rest of search", "Off Amazon") via `normalizePlacementName()` helper.
- **API Architecture**:
    - All API endpoints filter by `campaignType` (defaults to 'products').
    - **Campaign Type Filtering (Nov 2025 Fix)**: All three main endpoints (`/api/kpis`, `/api/countries`, `/api/chart-data`) now consistently filter by `campaignType` parameter. Previously, `/api/countries` and `/api/chart-data` aggregated all campaign types regardless of filter, causing KPI totals to not match countries table sums.
    - `adGroupId` filter is applied ONLY to Sponsored Products; ignored for Sponsored Brands and Display campaigns as they lack this field in a compatible structure.
    - API responses include calculated fields: `cpc`, `cvr`, `acos`.
    - Frontend renders use null guards for numeric values: `(val ?? 0).toFixed(2)`.

### AI Analytics Agent
- **Model**: Anthropic Claude claude-sonnet-4-20250514 via @anthropic-ai/sdk
- **Endpoint**: `/api/agent/query` with SSE streaming support
- **Tools Available (8 total)**:
    - `get_kpis`: Fetch aggregate KPIs (sales, ACOS, cost, clicks, orders) with date range and campaign type filters
    - `get_campaigns`: List campaigns with performance metrics, sorted by cost
    - `get_countries_performance`: Country-level breakdown with EUR conversion
    - `get_top_search_terms`: Search terms ranked by cost with bid recommendations
    - `get_negative_keyword_candidates`: Identify underperforming keywords (≥20 clicks, $0 sales)
    - `get_product_placements`: Sponsored Products placement-level performance (Top of Search, Product Pages, Rest of Search)
    - `get_brand_placements`: Sponsored Brands performance grouped by cost type
    - `get_display_targeting`: Display targeting performance by targeting expression
- **Response Time**: ~10-11 seconds for tool-using queries
- **Frontend**: Floating chat button (AgentChat component) with message history and suggested questions
- **Read-Only Access**: Agent can query all 6 Supabase tables but cannot modify data

## External Dependencies
- **Database**: Supabase (PostgreSQL).
- **Exchange Rates API**: Frankfurter API (European Central Bank rates).
- **AI Provider**: Anthropic API (ANTHROPIC_API_KEY in Replit Secrets).