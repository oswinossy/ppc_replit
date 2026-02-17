/**
 * Check for missing dates in s_brand_search_terms table.
 * Run from Replit shell: npx tsx scripts/check-missing-dates.ts
 */
import postgres from 'postgres';

const connectionUrl = process.env.DATABASE_URL;
if (!connectionUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(connectionUrl, { ssl: 'require' });

async function checkMissingDates() {
  // 1. Get date range and row counts per country
  const summary = await sql`
    SELECT
      country,
      MIN(date) as first_date,
      MAX(date) as last_date,
      COUNT(DISTINCT date) as distinct_dates,
      COUNT(*) as total_rows
    FROM s_brand_search_terms
    GROUP BY country
    ORDER BY country
  `;

  console.log('=== TABLE SUMMARY ===');
  for (const row of summary) {
    const first = new Date(row.first_date);
    const last = new Date(row.last_date);
    const expectedDays = Math.round((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`\nCountry: ${row.country}`);
    console.log(`  Date range: ${row.first_date} → ${row.last_date}`);
    console.log(`  Distinct dates: ${row.distinct_dates} / ${expectedDays} expected`);
    console.log(`  Total rows: ${row.total_rows}`);
    if (Number(row.distinct_dates) < expectedDays) {
      console.log(`  ⚠️  MISSING ${expectedDays - Number(row.distinct_dates)} day(s)`);
    } else {
      console.log(`  ✅ No missing dates`);
    }
  }

  // 2. Find actual missing dates using generate_series
  const gaps = await sql`
    WITH date_range AS (
      SELECT
        country,
        MIN(date)::date AS min_date,
        MAX(date)::date AS max_date
      FROM s_brand_search_terms
      GROUP BY country
    ),
    all_dates AS (
      SELECT
        dr.country,
        d::date AS date
      FROM date_range dr
      CROSS JOIN LATERAL generate_series(dr.min_date, dr.max_date, '1 day'::interval) AS d
    ),
    existing_dates AS (
      SELECT DISTINCT country, date::date AS date
      FROM s_brand_search_terms
    )
    SELECT
      a.country,
      a.date::text AS missing_date
    FROM all_dates a
    LEFT JOIN existing_dates e ON a.country = e.country AND a.date = e.date
    WHERE e.date IS NULL
    ORDER BY a.country, a.date
  `;

  if (gaps.length > 0) {
    console.log('\n=== MISSING DATES ===');
    let currentCountry = '';
    let streak: string[] = [];

    const flushStreak = (country: string) => {
      if (streak.length === 0) return;
      if (streak.length === 1) {
        console.log(`  ${streak[0]}`);
      } else {
        console.log(`  ${streak[0]} → ${streak[streak.length - 1]} (${streak.length} days)`);
      }
      streak = [];
    };

    for (const row of gaps) {
      if (row.country !== currentCountry) {
        flushStreak(currentCountry);
        currentCountry = row.country;
        console.log(`\nCountry: ${currentCountry}`);
      }

      const lastDate = streak.length > 0 ? streak[streak.length - 1] : null;
      if (lastDate) {
        const prev = new Date(lastDate);
        const curr = new Date(row.missing_date);
        const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 1) {
          flushStreak(currentCountry);
        }
      }
      streak.push(row.missing_date);
    }
    flushStreak(currentCountry);
  } else {
    console.log('\n✅ No missing dates found across any country!');
  }

  // 3. Show recent 14 days row counts to spot recent issues
  console.log('\n=== LAST 14 DAYS ROW COUNTS ===');
  const recent = await sql`
    SELECT
      date::text,
      country,
      COUNT(*) as rows
    FROM s_brand_search_terms
    WHERE date >= CURRENT_DATE - INTERVAL '14 days'
    GROUP BY date, country
    ORDER BY date DESC, country
  `;

  for (const row of recent) {
    console.log(`  ${row.date}  ${row.country}  ${row.rows} rows`);
  }

  await sql.end();
}

checkMissingDates().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
