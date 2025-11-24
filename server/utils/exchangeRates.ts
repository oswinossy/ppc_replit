/**
 * Exchange rate utilities using Frankfurter API (European Central Bank rates)
 * Free API with historical data from 1999 onwards, no API key required
 */

interface ExchangeRateResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface CurrencyMap {
  GBP: string;
  USD: string;
  SEK: string;
  PLN: string;
  EUR: string;
  [key: string]: string;
}

const currencyToFrankfurterCode: CurrencyMap = {
  'GBP': 'GBP',
  'USD': 'USD',
  'SEK': 'SEK',
  'PLN': 'PLN',
  'EUR': 'EUR',
};

/**
 * Fetch exchange rates for a specific date
 * Returns rates with EUR as base currency
 * For future dates, uses latest available rates
 */
export async function getExchangeRatesForDate(date: string): Promise<Record<string, number>> {
  try {
    // Check if date is in the future - use 'latest' endpoint
    const targetDate = new Date(date);
    const today = new Date();
    const useLatest = targetDate > today;
    
    const endpoint = useLatest ? 'latest' : date;
    const response = await fetch(`https://api.frankfurter.app/${endpoint}`);
    
    if (!response.ok) {
      // Silently use default rates for failed requests
      return getDefaultRates();
    }
    
    const data: ExchangeRateResponse = await response.json();
    
    // Frankfurter returns rates FROM EUR, we need rates TO EUR
    // So we invert the rates: if EUR->USD is 1.09, then USD->EUR is 1/1.09
    const toEurRates: Record<string, number> = {
      EUR: 1, // EUR to EUR is always 1
    };
    
    for (const [currency, rate] of Object.entries(data.rates)) {
      toEurRates[currency] = 1 / rate; // Invert to get "to EUR" rate
    }
    
    return toEurRates;
  } catch (error) {
    // Silently use default rates for errors
    return getDefaultRates();
  }
}

/**
 * Fetch exchange rates for a date range
 * Returns a map of date -> currency -> EUR conversion rate
 */
export async function getExchangeRatesForRange(
  startDate: string,
  endDate: string
): Promise<Map<string, Record<string, number>>> {
  try {
    // Frankfurter supports time series queries
    const response = await fetch(
      `https://api.frankfurter.app/${startDate}..${endDate}`
    );
    
    if (!response.ok) {
      console.error(`Failed to fetch exchange rates for range ${startDate} to ${endDate}`);
      const defaultRates = getDefaultRates();
      const ratesMap = new Map<string, Record<string, number>>();
      ratesMap.set(startDate, defaultRates);
      return ratesMap;
    }
    
    const data = await response.json();
    const ratesMap = new Map<string, Record<string, number>>();
    
    // Process each date in the response
    if (data.rates) {
      for (const [date, rates] of Object.entries(data.rates)) {
        const toEurRates: Record<string, number> = {
          EUR: 1,
        };
        
        for (const [currency, rate] of Object.entries(rates as Record<string, number>)) {
          toEurRates[currency] = 1 / rate; // Invert to get "to EUR" rate
        }
        
        ratesMap.set(date, toEurRates);
      }
    }
    
    return ratesMap;
  } catch (error) {
    console.error('Error fetching exchange rate range:', error);
    const defaultRates = getDefaultRates();
    const ratesMap = new Map<string, Record<string, number>>();
    ratesMap.set(startDate, defaultRates);
    return ratesMap;
  }
}

/**
 * Convert amount from source currency to EUR
 */
export function convertToEur(
  amount: number,
  sourceCurrency: string,
  exchangeRates: Record<string, number>
): number {
  if (sourceCurrency === 'EUR') return amount;
  
  const rate = exchangeRates[sourceCurrency];
  if (!rate) {
    // Silently use default rate (data may contain dates without API support)
    const defaultRates = getDefaultRates();
    const defaultRate = defaultRates[sourceCurrency];
    return defaultRate ? amount * defaultRate : amount;
  }
  
  return amount * rate;
}

/**
 * Default fallback rates (approximate)
 */
function getDefaultRates(): Record<string, number> {
  return {
    EUR: 1,
    USD: 0.92, // ~1 USD = 0.92 EUR
    GBP: 1.17, // ~1 GBP = 1.17 EUR
    SEK: 0.088, // ~1 SEK = 0.088 EUR
    PLN: 0.23, // ~1 PLN = 0.23 EUR
  };
}

/**
 * Get the latest available exchange rates
 */
export async function getLatestExchangeRates(): Promise<Record<string, number>> {
  return getExchangeRatesForDate('latest');
}
