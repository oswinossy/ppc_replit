/**
 * Simple in-memory cache for API responses
 * Dramatically improves dashboard load times by caching expensive aggregations
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes - aggressive caching for dashboard performance

/**
 * Get cached data if still fresh
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

/**
 * Store data in cache
 */
export function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
  
  // Clean up old entries (keep only last 50)
  if (cache.size > 50) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
}

/**
 * Generate cache key from request parameters
 */
export function generateCacheKey(endpoint: string, params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return `${endpoint}?${sortedParams}`;
}

/**
 * Clear all cache entries
 */
export function clearCache(): void {
  cache.clear();
}
