export const CURRENCIES: Record<
  string,
  { symbol: string; flag: string; label: string; usd: number }
> = {
  USD: { symbol: "$", flag: "🇺🇸", label: "Amerikan Doları", usd: 1 },
  EUR: { symbol: "€", flag: "🇪🇺", label: "Euro", usd: 1.08 },
  GBP: { symbol: "£", flag: "🇬🇧", label: "İngiliz Sterlini", usd: 1.27 },
  TRY: { symbol: "₺", flag: "🇹🇷", label: "Türk Lirası", usd: 0.026 },
};

export function convert(amount: number, from: string, to: string): number {
  const fromRate = CURRENCIES[from]?.usd ?? 1;
  const toRate = CURRENCIES[to]?.usd ?? 1;
  return Math.round(((amount * fromRate) / toRate) * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Fixed time zone so the server (UTC on Vercel) and the browser render the
 * same text; otherwise React reports a hydration mismatch (error #418).
 */
export const DISPLAY_TIME_ZONE = "Europe/Istanbul";

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
