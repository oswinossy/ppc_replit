# Elan - Amazon PPC Analytics Portal

## Overview
Elan is an internal analytics portal for Amazon PPC campaign data (Sponsored Products, Sponsored Brands, Display). It provides multi-level drilldown, KPI tracking, and bid recommendations using campaign-specific ACOS targets to optimize performance and increase sales. Key features include multi-currency display (with EUR conversion), negative keyword detection, and an AI analytics agent. The project aims to centralize data, provide actionable insights, and automate parts of the optimization process.

## User Preferences
- Prefer data-first over decorative UI
- M19.com-inspired clean design
- Professional color scheme

## System Architecture

### UI/UX Decisions
The portal features a professional, data-focused aesthetic inspired by Linear and Vercel, with a primary dark mode and theme toggle. It uses the Inter font family, responsive grid layouts, and color-coded ACOS badges (Green: <20%, Amber: 20-30%, Red: >30%). Navigation includes a sticky header, breadcrumbs, URL-persisted filters, and click-through drilldown tables. A dashboard-level campaign type filter (Sponsored Products, Sponsored Brands, Display) ensures consistent data views.

### Technical Implementations
The frontend is built with React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, and Wouter. The backend utilizes Express, Drizzle ORM, and PostgreSQL (Supabase). Performance is optimized through frontend date range initialization, 2-minute API response caching, 5-minute exchange rate caching, and composite database indexes.

Core functionalities include:
- **Multi-level Drilldown**: From Dashboard down to Targeting.
- **Campaign Type Segmentation**: Dashboard filter for Sponsored Products, Brands, and Display.
- **EUR Currency Conversion**: All metrics displayed in EUR, with country-specific views showing local currency.
- **Placement Analysis**: Performance by placement type.
- **KPI Tracking**: Sales, ACOS, CPC, Cost, CVR, Orders, with 30-day attribution for Sponsored Products.
- **Performance Charts**: Weekly aggregated ACOS and sales trends.
- **Bid Recommendations**: Campaign-specific ACOS targets for keywords/ASINs, with confidence levels based on click volume.
- **Negative Keywords**: Auto-detection (≥20 clicks, $0 sales) with Excel export.
- **Date Range Filtering**: Presets and custom date picker.

### Feature Specifications
- **Campaign-Level Placement Bid Adjustments**: Percentage modifiers targeting 20% ACOS, scaled by confidence (click volume).
- **Recommendation Engine**: Bid adjustments based on ACOS and sales data, with safeguards (20%-150% of base bid) and confidence levels.
- **Currency Conversion System**: Comprehensive system handling multi-currency display, conversion to EUR using Frankfurter API, and propagation across drill-down views, with fallbacks for missing rates.
- **Bid Change History Tracking**: Tracks keyword bid adjustments for Sponsored Products and Brands, detecting changes daily and providing API access for history and last changes.
- **Campaign-Specific ACOS Targets**: Replaces hardcoded ACOS with per-campaign targets stored in `ACOS_Target_Campaign` table, importable via CSV, and integrated into bid recommendation calculations.
- **Intelligent Bidding Strategy System**: Analyzes ACOS across multiple timeframes (since last bid change, 30D, 365D, Lifetime) using configurable weights. It provides recommendations based on ACOS window, minimum clicks, cooldown periods, and bid caps. Recommendations are tracked with pre-ACOS snapshots and confidence levels.
- **AI Analytics Agent**: Uses Anthropic Claude Opus 4.5 via SSE streaming. It has 10 tools for querying KPIs, campaigns, search terms, placements, data coverage, and daily breakdowns. The agent provides read-only access to Supabase data.

### System Design Choices
The database is Supabase PostgreSQL, structured with separate tables for Brand, Product, and Display campaigns, accommodating their specific data types and structures. API architecture consistently filters by `campaignType` and calculates KPIs like `cpc`, `cvr`, `acos`.

## External Dependencies
- **Database**: Supabase (PostgreSQL).
- **Exchange Rates API**: Frankfurter API (European Central Bank rates).
- **AI Provider**: Anthropic API (for Claude Opus 4.5).