/** Formats integer minor units (cents) for display. The API never sends floating-point prices. */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** "12", "12.5" or "12.50" → 1250 cents. Anything else (negative, 3 decimals, letters) → null. */
export function parseMoneyToCents(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 1250 → "12.50", for pre-filling a price field. */
export const centsToInput = (cents: number): string => (cents / 100).toFixed(2);
