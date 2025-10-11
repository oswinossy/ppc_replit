export function calculateACOS(cost: number, sales: number): number {
  if (sales === 0) return 0;
  return (cost / sales) * 100;
}

export function calculateCPC(cost: number, clicks: number): number {
  if (clicks === 0) return 0;
  return cost / clicks;
}

export function calculateCVR(orders: number, clicks: number): number {
  if (clicks === 0) return 0;
  return (orders / clicks) * 100;
}

export function calculateROAS(sales: number, cost: number): number {
  if (cost === 0) return 0;
  return sales / cost;
}

export function formatCurrency(value: number, currency: string = 'EUR'): string {
  const symbols: Record<string, string> = {
    'EUR': '€',
    'USD': '$',
    'GBP': '£',
  };
  return `${symbols[currency] || currency}${value.toFixed(2)}`;
}

export function getConfidenceLevel(clicks: number): { label: string; level: number } {
  if (clicks >= 1000) return { label: 'Extreme', level: 4 };
  if (clicks >= 300) return { label: 'High', level: 3 };
  if (clicks >= 100) return { label: 'Good', level: 2 };
  if (clicks >= 30) return { label: 'OK', level: 1 };
  return { label: 'Low', level: 0 };
}
