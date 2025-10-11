# Elan Amazon PPC Portal - Design Guidelines

## Design Approach

**Selected Framework:** Design System Approach (Data-Focused)

**Primary Inspiration:** Linear + Vercel Dashboard aesthetics combined with M19's functional clarity

**Rationale:** This is a utility-focused analytics platform where data clarity, efficient navigation, and professional presentation are paramount. The design prioritizes information hierarchy, scannable metrics, and intuitive drilldown patterns over decorative elements.

**Core Principles:**
- Data First: Every design decision serves data comprehension
- Contextual Clarity: Users always know where they are in the hierarchy
- Responsive Precision: Dense data adapts gracefully across devices
- Performance Focus: Minimal visual noise, maximum insight

---

## Color Palette

### Dark Mode (Primary)
- **Background Hierarchy:**
  - Primary: 240 10% 3.9% (deep slate, main canvas)
  - Secondary: 240 10% 8% (elevated surfaces - cards, tables)
  - Tertiary: 240 10% 12% (hover states, selected rows)

- **Brand & Interactive:**
  - Primary Blue: 217 91% 60% (CTAs, active states, primary metrics)
  - Success Green: 142 76% 45% (positive trends, profitable ACOS)
  - Warning Amber: 38 92% 50% (alerts, ACOS approaching target)
  - Error Red: 0 84% 60% (negative trends, wasteful spend)

- **Text & Borders:**
  - Primary Text: 0 0% 98% (headings, key metrics)
  - Secondary Text: 240 5% 65% (labels, descriptions)
  - Muted Text: 240 5% 45% (metadata, timestamps)
  - Border: 240 10% 15% (dividers, table borders)

### Light Mode (Secondary)
- Background: 0 0% 100%
- Secondary: 240 5% 96%
- Borders: 240 6% 90%
- Text inverted from dark mode values

---

## Typography

**Font Family:** Inter (via Google Fonts CDN)

**Scale & Weights:**
- Display (Dashboard Title): 32px / font-bold (Elan brand)
- H1 (Page Headers): 24px / font-semibold
- H2 (Section Headers): 20px / font-semibold
- H3 (Card Titles): 16px / font-semibold
- Body (General Text): 14px / font-normal
- Small (Metadata): 12px / font-normal
- Data Tables: 13px / font-mono (for numeric alignment)
- KPI Values: 28px / font-bold (metric cards)

**Line Height:** 1.5 for body, 1.2 for headings, 1.3 for data tables

---

## Layout System

**Spacing Primitives:** Use Tailwind units of **2, 3, 4, 6, 8, 12, 16** exclusively
- Component padding: p-4 or p-6
- Section spacing: space-y-6 or space-y-8
- Card gaps: gap-4 or gap-6
- Table cell padding: px-4 py-3

**Grid Structure:**
- Dashboard Container: max-w-[1600px] mx-auto px-4 md:px-6
- KPI Cards: grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4
- Data Tables: Full width with horizontal scroll on mobile
- Charts: Minimum height h-[400px], responsive width

**Navigation:**
- Sticky top navigation: h-16 with Elan logo, breadcrumb trail, user menu
- Sticky filter bar: h-14 below nav with time picker and scope selectors
- Sidebar (optional): 64px collapsed, 240px expanded for quick navigation

---

## Component Library

### Core Data Components

**KPI Metric Cards:**
- White/dark background with subtle border
- Large numeric value (28px bold) with trend indicator (↑↓ with color)
- Label below (12px muted)
- Compact: 16:9 aspect ratio, responsive grid
- Subtle hover state: border color shift

**Data Tables:**
- Striped rows (zebra pattern) for scannability
- Fixed header on scroll (sticky)
- Sortable columns with subtle arrow indicators
- Row hover: background-tertiary with smooth transition
- Numeric columns: right-aligned, monospace font
- Action columns: left-aligned, compact icon buttons
- Pagination: Bottom-right, shows "1-50 of 1,234"

**Charts (Recharts):**
- Line Charts: Thin strokes (2px), smooth curves, area fill at 20% opacity
- Bar Charts: Rounded corners (radius-sm), gap between bars
- Axis: Muted color, 12px font
- Tooltips: Dark card with white text, rounded-lg, shadow-xl
- Legend: Top-right, horizontal layout, 13px font
- Grid: Subtle horizontal lines only (background-tertiary)

**Recommendation Cards:**
- Split layout: Current | Proposed with delta badge
- Confidence indicator: Pill badge (OK/Good/High/Extreme) color-coded
- Expandable rationale: Accordion pattern
- Batch actions: Checkbox selection with bulk apply button

### Navigation & Filters

**Breadcrumb Navigation:**
- Horizontal chain with "/" separators
- Clickable ancestors (text-blue-500 hover:underline)
- Current page: text-primary, no link
- Compact: py-2, text-sm

**Time Range Picker:**
- Button group: 7D | 14D | 30D | 60D | 90D | Custom
- Active state: bg-primary text-white
- Custom: Opens date range modal with calendar
- Displays selected range below (text-muted, text-xs)

**Filter Chips:**
- Rounded-full pills with remove "×" button
- Applied filters: bg-blue-500/10 text-blue-500
- Hover: bg-blue-500/20
- Clear all: text-sm link on right

### Forms & Inputs

**Input Fields:**
- Height: h-10
- Border: border-input bg-background
- Focus: ring-2 ring-primary ring-offset-2
- Dark mode: Maintain contrast, no pure white backgrounds

**Select Dropdowns:**
- Match input styling
- Dropdown: bg-secondary, shadow-lg, rounded-lg
- Option hover: bg-tertiary

**Buttons:**
- Primary: bg-primary text-white h-10 px-6 rounded-md font-medium
- Secondary: border border-input bg-background hover:bg-secondary
- Destructive: bg-red-500 text-white
- Ghost: hover:bg-secondary (for icon buttons)

### Overlays

**Modals:**
- Max-width: max-w-2xl for forms, max-w-5xl for data previews
- Backdrop: bg-black/50 backdrop-blur-sm
- Content: bg-background rounded-xl shadow-2xl p-6
- Header: border-b pb-4 with close button (top-right)

**Tooltips:**
- Small: max-w-xs, bg-gray-900 text-white text-xs p-2 rounded-md
- Arrow indicator pointing to trigger
- Delay: 200ms on hover

**Toasts:**
- Bottom-right position
- Success: border-l-4 border-green-500
- Error: border-l-4 border-red-500
- Auto-dismiss: 5 seconds

---

## Data Visualization Patterns

**Color Usage in Charts:**
- ACOS Line: text-amber-500 (warning indicator)
- Sales Line: text-blue-500 (primary metric)
- Profitable areas: Fill with green-500/20
- Problematic areas: Fill with red-500/20
- Neutral data: text-gray-400

**Table Column Treatments:**
- Metric Columns: Right-aligned, bold values, muted labels
- Percentage Columns: Color-coded (green <20%, amber 20-30%, red >30% ACOS)
- Currency: Right-aligned with currency symbol prefix
- Match Type: Badge component (Exact/Phrase/Broad) with distinct colors

**Drilldown Indicators:**
- Clickable rows: cursor-pointer, hover:bg-tertiary
- Chevron-right icon on far right (text-muted)
- External links: Icon external-link (lucide-react)

---

## Responsive Behavior

**Breakpoints:**
- Mobile: < 768px (stack everything, hide non-essential columns)
- Tablet: 768px - 1024px (2-column KPIs, scrollable tables)
- Desktop: > 1024px (full 6-column KPIs, all data visible)

**Mobile Adaptations:**
- Replace data tables with card stacks below 768px
- Hamburger menu for navigation
- Bottom sheet for filters instead of sidebar
- Swipeable charts for multiple metrics

---

## Animation & Transitions

**Minimal, Purposeful Motion:**
- Page transitions: None (instant navigation)
- Hover states: transition-colors duration-150
- Modal entry: fade + scale from 95% to 100% in 200ms
- Chart animations: Recharts default (300ms ease)
- Loading states: Skeleton screens (pulsing opacity-50 to opacity-100)

**No Animations:**
- No parallax effects
- No scroll-triggered animations
- No decorative micro-interactions

---

## Special Considerations

**Recommendation Table:**
- Use diff-style visualization: Old → New with visual arrow
- Delta badge: Absolute positioned, top-right of card
- Batch selection: Sticky header with "X selected" counter

**Negative Keywords Export:**
- Export button: Icon with text "Export Negatives (.xlsx)"
- Confirm modal showing scope and count before download
- Success toast with download link

**Empty States:**
- Centered illustration (simple line icon from lucide-react)
- Heading: "No data for selected period"
- Action: "Adjust filters" button or helpful tip

**Loading States:**
- Skeleton cards matching KPI layout
- Shimmering effect: animate-pulse
- Table: Show 5 skeleton rows with gray blocks