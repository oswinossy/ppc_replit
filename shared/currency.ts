/**
 * Currency utilities for multi-currency support
 * Supports EUR, USD, GBP, SEK, PLN
 */

export type SupportedCurrency = 'EUR' | 'USD' | 'GBP' | 'SEK' | 'PLN';

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
};

/**
 * Get currency code for a country
 */
export function getCurrencyForCountry(countryCode: string): SupportedCurrency {
  return COUNTRY_TO_CURRENCY[countryCode.toUpperCase()] || 'EUR';
}
