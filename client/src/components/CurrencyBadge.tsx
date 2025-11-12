import { Badge } from "@/components/ui/badge";
import { getCurrencyForCountry, getCurrencySymbol } from "@shared/currency";

interface CurrencyBadgeProps {
  countryCode: string | null;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  SE: 'Sweden',
  PL: 'Poland',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  BE: 'Belgium',
  AT: 'Austria',
};

export default function CurrencyBadge({ countryCode }: CurrencyBadgeProps) {
  if (!countryCode) return null;
  
  const currency = getCurrencyForCountry(countryCode);
  const symbol = getCurrencySymbol(currency);
  const countryName = COUNTRY_NAMES[countryCode.toUpperCase()] || countryCode;
  
  return (
    <Badge 
      variant="outline" 
      className="h-7 px-3 text-sm font-medium"
      data-testid="badge-currency"
    >
      <span className="mr-1.5">{symbol}</span>
      {countryName}
    </Badge>
  );
}
