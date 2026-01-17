/**
 * Currency utilities for multi-currency support
 * Supports EUR, USD, GBP, SEK, PLN, JPY, CAD
 */

export type SupportedCurrency = 'EUR' | 'USD' | 'GBP' | 'SEK' | 'PLN' | 'JPY' | 'CAD';

export interface CurrencyInfo {
  code: SupportedCurrency;
  symbol: string;
  name: string;
}

const CURRENCY_MAP: Record<SupportedCurrency, CurrencyInfo> = {
  EUR: { code: 'EUR', symbol: '€', name: 'Euro' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound' },
  SEK: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  PLN: { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
};

/**
 * Get currency symbol for a given currency code
 */
export function getCurrencySymbol(currencyCode: string): string {
  const currency = CURRENCY_MAP[currencyCode as SupportedCurrency];
  return currency?.symbol || currencyCode;
}

/**
 * Get currency name for a given currency code
 */
export function getCurrencyName(currencyCode: string): string {
  const currency = CURRENCY_MAP[currencyCode as SupportedCurrency];
  return currency?.name || currencyCode;
}

/**
 * Get full currency info for a given currency code
 */
export function getCurrencyInfo(currencyCode: string): CurrencyInfo {
  return CURRENCY_MAP[currencyCode as SupportedCurrency] || {
    code: currencyCode as SupportedCurrency,
    symbol: currencyCode,
    name: currencyCode,
  };
}

/**
 * Map country code to currency code
 */
export const COUNTRY_TO_CURRENCY: Record<string, SupportedCurrency> = {
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  US: 'USD',
  GB: 'GBP',
  UK: 'GBP',
  SE: 'SEK',
  PL: 'PLN',
  JP: 'JPY',
  CA: 'CAD',
};

/**
 * Get currency code for a country
 */
export function getCurrencyForCountry(countryCode: string): SupportedCurrency {
  return COUNTRY_TO_CURRENCY[countryCode.toUpperCase()] || 'EUR';
}

/**
 * Normalize Amazon placement names to match Amazon UI terminology
 * Maps database placement values to user-friendly names
 */
export function normalizePlacementName(placement: string | null): string {
  if (!placement) return 'Unknown';
  
  const normalizedMap: Record<string, string> = {
    'Top of Search on-Amazon': 'Top of search (first page)',
    'Detail Page on-Amazon': 'Product pages',
    'Other on-Amazon': 'Rest of search',
    'Off Amazon': 'Off Amazon',
    'UNKNOWN': 'Unknown',
  };
  
  return normalizedMap[placement] || placement;
}

/**
 * Map "Bid Adjustments" table placement names to normalized placement names
 * This enables linking bid adjustment percentages to placement performance data
 */
export const BID_ADJUSTMENT_PLACEMENT_MAP: Record<string, string> = {
  'Placement Top': 'Top of search (first page)',
  'Placement Product Page': 'Product pages',
  'Placement Rest Of Search': 'Rest of search',
  'Site Amazon Business': 'Amazon Business',
};

/**
 * Get the bid adjustment table placement key from normalized placement name
 * Used for reverse lookup when querying bid adjustments
 */
export function getBidAdjustmentPlacementKey(normalizedPlacement: string): string | null {
  const reverseMap: Record<string, string> = {
    'Top of search (first page)': 'Placement Top',
    'Product pages': 'Placement Product Page',
    'Rest of search': 'Placement Rest Of Search',
    'Amazon Business': 'Site Amazon Business',
  };
  return reverseMap[normalizedPlacement] || null;
}
