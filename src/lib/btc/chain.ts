/**
 * Verifies a BTC deposit against real Bitcoin MAINNET data from two independent
 * Esplora-compatible explorers (no API key):
 *   - https://mempool.space/api   GET /tx/:txid, GET /blocks/tip/height
 *   - https://blockstream.info/api (same endpoints)
 *
 * A deposit matches only if ALL hold:
 *   - the transaction exists and pays the request's address
 *   - exactly the requested number of satoshis (each open request has a unique amount)
 *   - it is not older than the request and was mined in time
 *   - it has at least the required number of confirmations
 *   - no explorer reports something different
 */

const EXPLORERS = [
  { name: "mempool.space", base: "https://mempool.space/api" },
  { name: "blockstream.info", base: "https://blockstream.info/api" },
];

type EsploraTx = {
  txid: string;
  vout: { scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
};

export type SourceResult = {
  source: string;
  reachable: boolean;
  found: boolean;
  paidSats: number;
  confirmed: boolean;
  blockHeight: number | null;
  blockTime: string | null;
  confirmations: number;
};

export type DepositVerification = {
  txid: string;
  address: string;
  expectedSats: number;
  paidSats: number;
  confirmations: number;
  requiredConfirmations: number;
  matched: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
  sources: SourceResult[];
  checkedAt: string;
  network: "mainnet";
};

export type DepositToVerify = {
  txid: string;
  btcAddress: string;
  amountSats: number;
  createdAt: string;
  expiresAt: string;
};

/** Mined up to this long after the quote expired still counts (block times vary). */
const MINING_GRACE_MS = 3 * 60 * 60 * 1000;
/** Block timestamps may be up to ~2 hours off. */
const CLOCK_SKEW_MS = 2 * 60 * 60 * 1000;

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text (e.g. tip height) */
  }
  return { status: response.status, body };
}

async function checkExplorer(
  explorer: (typeof EXPLORERS)[number],
  txid: string,
  address: string,
): Promise<SourceResult> {
  const empty: SourceResult = {
    source: explorer.name, reachable: false, found: false, paidSats: 0,
    confirmed: false, blockHeight: null, blockTime: null, confirmations: 0,
  };
  try {
    const tx = await getJson(`${explorer.base}/tx/${txid}`);
    if (tx.status === 404 || tx.status === 400) return { ...empty, reachable: true };
    if (tx.status !== 200 || typeof tx.body !== "object" || tx.body === null) return empty;
    const data = tx.body as EsploraTx;
    if (data.txid !== txid || !Array.isArray(data.vout)) return empty;

    const paidSats = data.vout
      .filter((out) => out.scriptpubkey_address === address)
      .reduce((sum, out) => sum + (Number.isSafeInteger(out.value) ? out.value : 0), 0);
    const confirmed = Boolean(data.status?.confirmed);
    let confirmations = 0;
    if (confirmed && typeof data.status.block_height === "number") {
      const tip = await getJson(`${explorer.base}/blocks/tip/height`);
      const height = Number(tip.body);
      if (tip.status === 200 && Number.isSafeInteger(height) && height >= data.status.block_height) {
        confirmations = height - data.status.block_height + 1;
      }
    }
    return {
      source: explorer.name,
      reachable: true,
      found: true,
      paidSats,
      confirmed,
      blockHeight: confirmed ? data.status.block_height ?? null : null,
      blockTime: confirmed && data.status.block_time ? new Date(data.status.block_time * 1000).toISOString() : null,
      confirmations,
    };
  } catch {
    return empty;
  }
}

export async function verifyDeposit(
  deposit: DepositToVerify,
  requiredConfirmations: number,
): Promise<DepositVerification> {
  const txid = deposit.txid.toLowerCase();
  const sources = await Promise.all(EXPLORERS.map((e) => checkExplorer(e, txid, deposit.btcAddress)));
  const answered = sources.filter((s) => s.reachable);
  const found = sources.filter((s) => s.found);

  const best = found.reduce<SourceResult | null>(
    (acc, s) => (!acc || s.confirmations > acc.confirmations ? s : acc),
    null,
  );
  const paidSats = best?.paidSats ?? 0;
  const confirmations = found.length ? Math.min(...found.map((s) => s.confirmations)) : 0;
  const blockTime = best?.blockTime ? new Date(best.blockTime).getTime() : null;
  const created = new Date(deposit.createdAt).getTime();
  const expires = new Date(deposit.expiresAt).getTime();

  const checks = [
    {
      label: "Blockchain data available",
      ok: answered.length > 0,
      detail: answered.length
        ? `Answered: ${answered.map((s) => s.source).join(", ")}`
        : "No explorer could be reached. Try again later.",
    },
    {
      label: "Transaction found on Bitcoin mainnet",
      ok: found.length > 0 && found.length === answered.length,
      detail: found.length
        ? `Found by ${found.map((s) => s.source).join(", ")}`
        : "Transaction ID not found. It may be wrong, not broadcast yet, or on another network.",
    },
    {
      label: "Explorers agree",
      ok: found.every((s) => s.paidSats === paidSats && s.confirmed === found[0].confirmed),
      detail: found.map((s) => `${s.source}: ${s.paidSats} sats, ${s.confirmations} conf.`).join(" · ") || "—",
    },
    {
      label: "Pays the deposit address",
      ok: paidSats > 0,
      detail: paidSats > 0 ? deposit.btcAddress : `No output to ${deposit.btcAddress}`,
    },
    {
      label: "Exact amount",
      ok: paidSats === deposit.amountSats,
      detail: `Expected ${deposit.amountSats} sats, received ${paidSats} sats`,
    },
    {
      label: "Paid within the quote window",
      ok: blockTime === null
        ? false
        : blockTime >= created - CLOCK_SKEW_MS && blockTime <= expires + MINING_GRACE_MS,
      detail: blockTime === null
        ? "Not mined yet"
        : `Mined ${new Date(blockTime).toISOString()} (request ${new Date(created).toISOString()})`,
    },
    {
      label: `At least ${requiredConfirmations} confirmations`,
      ok: confirmations >= requiredConfirmations,
      detail: `${confirmations} confirmation${confirmations === 1 ? "" : "s"}`,
    },
  ];

  return {
    txid,
    address: deposit.btcAddress,
    expectedSats: deposit.amountSats,
    paidSats,
    confirmations,
    requiredConfirmations,
    matched: checks.every((c) => c.ok),
    checks,
    sources,
    checkedAt: new Date().toISOString(),
    network: "mainnet",
  };
}
