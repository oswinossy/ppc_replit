import { useLocation } from "wouter";
import { useMemo } from "react";

/**
 * Custom hook to extract query parameters from the URL
 * Uses window.location.search since Wouter's location only contains pathname
 */
export function useSearchParams() {
  const [location] = useLocation();
  
  // Re-compute when location changes
  const params = useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search);
    return {
      country: searchParams.get('country'),
      // Add more params here as needed
      get: (key: string) => searchParams.get(key),
      toString: () => searchParams.toString(),
    };
  }, [location]);
  
  return params;
}
