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

### Technical Implementations
- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, Wouter.
- **Backend**: Express, Drizzle ORM, PostgreSQL (Supabase).
- **Core Features**:
    - **Multi-level Drilldown**: Dashboard → Countries → Campaigns → Ad Groups → Search Terms.
    - **Campaign Type Segmentation**: 6-view system (3 campaign types × 2 views: Search Terms, Placements).
    - **EUR Currency Conversion**: All metrics displayed in EUR using daily ECB exchange rates; country-specific views show local currency.
    - **Placement Analysis**: Campaign-level performance by placement type (TOS, ROS, PP, UNKNOWN).
    - **KPI Tracking**: Sales, ACOS, CPC, Cost, CVR, Orders.
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
    - **Dashboard**: All metrics displayed in EUR with full conversion from all currencies (USD, GBP, SEK, PLN) using daily ECB exchange rates.
    - **Country Views**: Metrics displayed in local currency (USD for US, GBP for GB, SEK for SE, PLN for PL, EUR for DE/FR/etc).
    - **Currency Preservation**: Navigation preserves currency throughout drill-down chain (Dashboard → Country → Campaign → Ad Group).
    - **Currency Symbols**: Visual indicators display £, $, kr, zł, € symbols in country-specific views via CurrencyBadge component.
    - **API Support**: All endpoints (`/api/kpis`, `/api/chart-data`, `/api/campaigns`, `/api/search-terms`) support `convertToEur` parameter.
    - **Multi-Currency Guards**: Backend validates single-currency aggregation when `convertToEur=false` to prevent mixing USD+GBP+etc.
    - **Exchange Rates**: Uses Frankfurter API (European Central Bank) for daily rates with date-range support.
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
    - `adGroupId` filter is applied ONLY to Sponsored Products; ignored for Sponsored Brands and Display campaigns as they lack this field in a compatible structure.
    - API responses include calculated fields: `cpc`, `cvr`, `acos`.
    - Frontend renders use null guards for numeric values: `(val ?? 0).toFixed(2)`.

## External Dependencies
- **Database**: Supabase (PostgreSQL).
- **Exchange Rates API**: Frankfurter API (European Central Bank rates).