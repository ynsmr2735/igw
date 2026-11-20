import { SetupError } from "@/lib/supabase";

/**
 * Current BTC/USD price from two independent public sources (no API key):
 *   - mempool.space  GET /api/v1/prices        -> { time, USD, ... }
 *   - Coinbase       GET /v2/prices/BTC-USD/spot -> { data: { amount } }
 * If both answer and differ by more than 2 %, no quote is given.
 */

const SOURCES = [
  {
    name: "mempool.space",
    url: "https://mempool.space/api/v1/prices",
    read: (json: unknown) => Number((json as { USD?: unknown })?.USD),
  },
  {
    name: "coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    read: (json: unknown) => Number((json as { data?: { amount?: unknown } })?.data?.amount),
  },
];

const MIN_SANE = 1_000;
const MAX_SANE = 10_000_000;
const MAX_SPREAD = 0.02;

export type BtcPrice = { rate: number; source: string };

async function fetchSource(source: (typeof SOURCES)[number]): Promise<number | null> {
  try {
    const response = await fetch(source.url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const rate = source.read(await response.json());
    return Number.isFinite(rate) && rate >= MIN_SANE && rate <= MAX_SANE ? rate : null;
  } catch {
    return null;
  }
}

export async function getBtcUsdPrice(): Promise<BtcPrice> {
  const rates = await Promise.all(SOURCES.map(fetchSource));
  const available = SOURCES.map((s, i) => ({ name: s.name, rate: rates[i] })).filter(
    (r): r is { name: string; rate: number } => r.rate !== null,
  );
  if (available.length === 0) {
    throw new SetupError("The BTC price is temporarily unavailable. Please try again in a minute.");
  }
  if (available.length === 2) {
    const [a, b] = available;
    if (Math.abs(a.rate - b.rate) / Math.min(a.rate, b.rate) > MAX_SPREAD) {
      throw new SetupError("BTC price sources disagree right now. Please try again in a minute.");
    }
    return {
      rate: Math.round(((a.rate + b.rate) / 2) * 100) / 100,
      source: `${a.name}+${b.name}`,
    };
  }
  return { rate: Math.round(available[0].rate * 100) / 100, source: available[0].name };
}
