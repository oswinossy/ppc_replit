import { getExchangeRatesForDate, convertToEur } from './exchangeRates';

/**
 * Aggregate metrics with optional EUR conversion
 * @param results - Array of results with date, currency, and metric fields
 * @param shouldConvertToEur - Whether to convert to EUR or keep local currency
 * @returns Aggregated metrics with currency
 */
export async function aggregateWithCurrency(
  results: Array<{ date: any; currency: any; clicks: number; cost: number; sales: number; orders: number }>,
  shouldConvertToEur: boolean
): Promise<{
  totalClicks: number;
  totalCost: number;
  totalSales: number;
  totalOrders: number;
  currency: string;
}> {
  let totalClicks = 0;
  let totalCost = 0;
  let totalSales = 0;
  let totalOrders = 0;
  let resultCurrency = 'EUR';

  if (shouldConvertToEur) {
    // Get unique dates for exchange rate fetching
    const uniqueDates = new Set<string>();
    results.forEach(row => row.date && uniqueDates.add(row.date));

    // Fetch exchange rates for each unique date
    const exchangeRatesCache = new Map<string, Record<string, number>>();
    for (const date of Array.from(uniqueDates)) {
      const rates = await getExchangeRatesForDate(date);
      exchangeRatesCache.set(date, rates);
    }

    // Convert to EUR and aggregate
    results.forEach(row => {
      if (!row.date) return;
      
      const rates = exchangeRatesCache.get(row.date) || {};
      const costEur = convertToEur(Number(row.cost), row.currency || 'EUR', rates);
      const salesEur = convertToEur(Number(row.sales), row.currency || 'EUR', rates);

      totalClicks += Number(row.clicks);
      totalCost += costEur;
      totalSales += salesEur;
      totalOrders += Number(row.orders);
    });
    resultCurrency = 'EUR';
  } else {
    // Keep local currency - no conversion
    // GUARD: Ensure single currency when not converting
    const uniqueCurrencies = new Set(results.map(r => r.currency).filter(Boolean));
    if (uniqueCurrencies.size > 1) {
      throw new Error('Cannot aggregate multiple currencies without conversion. Use convertToEur=true or filter by country.');
    }
    
    results.forEach(row => {
      totalClicks += Number(row.clicks);
      totalCost += Number(row.cost);
      totalSales += Number(row.sales);
      totalOrders += Number(row.orders);
    });
    // Safe to use first currency now - we've verified there's only one
    resultCurrency = results[0]?.currency || 'EUR';
  }

  return {
    totalClicks,
    totalCost,
    totalSales,
    totalOrders,
    currency: resultCurrency,
  };
}
