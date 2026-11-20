import { realPaymentExceptAmount, requiredChecksPass, type DepositVerification, type VerificationSource } from "@/lib/payment-methods";

/**
 * Verifies a BTC deposit against real Bitcoin MAINNET data from two independent
 * Esplora-compatible explorers (no API key):
 *   - https://mempool.space/api   GET /tx/:txid, GET /blocks/tip/height
 *   - https://blockstream.info/api (same endpoints)
 *
 * A deposit matches only if ALL hold:
 *   - the transaction exists and pays the request's address
 *   - exactly the requested number of satoshis (each open request has a unique amount)
 *   - it was not made before the request was created (a late payment is only
 *     flagged to the admin: requests never expire, the admin decides)
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

export type DepositToVerify = {
  txid: string;
  address: string;
  amountUnits: number;
  createdAt: string;
  expiresAt: string;
};

/** Mined up to this long after the quote expired still counts (block times vary). */
const MINING_GRACE_MS = 3 * 60 * 60 * 1000;
/** Block timestamps may be up to ~2 hours off. */
const CLOCK_SKEW_MS = 2 * 60 * 60 * 1000;

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
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
): Promise<VerificationSource> {
  const empty: VerificationSource = {
    source: explorer.name, reachable: false, found: false, paidUnits: 0,
    confirmed: false, blockHeight: null, blockTime: null, confirmations: 0,
  };
  try {
    const tx = await getJson(`${explorer.base}/tx/${txid}`);
    if (tx.status === 404 || tx.status === 400) return { ...empty, reachable: true };
    if (tx.status !== 200 || typeof tx.body !== "object" || tx.body === null) {
      return { ...empty, error: `HTTP ${tx.status}${tx.status === 429 ? " (rate limit)" : ""}` };
    }
    const data = tx.body as EsploraTx;
    if (data.txid !== txid || !Array.isArray(data.vout)) return empty;

    const paidUnits = data.vout
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
      paidUnits,
      confirmed,
      blockHeight: confirmed ? data.status.block_height ?? null : null,
      blockTime: confirmed && data.status.block_time ? new Date(data.status.block_time * 1000).toISOString() : null,
      confirmations,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

export async function verifyBtcDeposit(
  deposit: DepositToVerify,
  requiredConfirmations: number,
): Promise<DepositVerification> {
  const txid = deposit.txid.toLowerCase();
  const sources = await Promise.all(EXPLORERS.map((e) => checkExplorer(e, txid, deposit.address)));
  const answered = sources.filter((s) => s.reachable);
  const found = sources.filter((s) => s.found);

  const best = found.reduce<VerificationSource | null>(
    (acc, s) => (!acc || s.confirmations > acc.confirmations ? s : acc),
    null,
  );
  const paidUnits = best?.paidUnits ?? 0;
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
        : `No explorer could be reached (${sources.map((s) => `${s.source}: ${s.error ?? "no answer"}`).join(", ")}). Try again later.`,
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
      ok: found.every((s) => s.paidUnits === paidUnits && s.confirmed === found[0].confirmed),
      detail: found.map((s) => `${s.source}: ${s.paidUnits} sats, ${s.confirmations} conf.`).join(" · ") || "—",
    },
    {
      label: "Pays the deposit address",
      ok: paidUnits > 0,
      detail: paidUnits > 0 ? deposit.address : `No output to ${deposit.address}`,
    },
    {
      label: "Exact amount",
      key: "amount" as const,
      ok: paidUnits === deposit.amountUnits,
      detail: `Expected ${deposit.amountUnits} sats, received ${paidUnits} sats`,
    },
    {
      label: "Paid after the request was created",
      ok: blockTime !== null && blockTime >= created - CLOCK_SKEW_MS,
      detail: blockTime === null
        ? "Not mined yet"
        : `Mined ${new Date(blockTime).toISOString()} (request ${new Date(created).toISOString()})`,
    },
    {
      label: "Paid within the payment window",
      advisory: true,
      ok: blockTime !== null && blockTime <= expires + MINING_GRACE_MS,
      detail: blockTime === null
        ? "Not mined yet"
        : blockTime <= expires + MINING_GRACE_MS
          ? "In time"
          : "Paid late: the BTC price may have changed since the quote. Your decision.",
    },
    {
      label: `At least ${requiredConfirmations} confirmations`,
      ok: confirmations >= requiredConfirmations,
      detail: `${confirmations} confirmation${confirmations === 1 ? "" : "s"}`,
    },
  ];

  return {
    method: "btc",
    network: "mainnet",
    txid,
    address: deposit.address,
    expectedUnits: deposit.amountUnits,
    paidUnits,
    confirmations,
    requiredConfirmations,
    matched: requiredChecksPass(checks),
    matchedExceptAmount: realPaymentExceptAmount(checks, paidUnits),
    checks,
    sources,
    checkedAt: new Date().toISOString(),
  };
}

/** Quick connectivity test for the admin status panel. */
export async function testBitcoinExplorers(): Promise<{ ok: boolean; detail: string }> {
  const results = await Promise.all(
    EXPLORERS.map(async (e) => {
      try {
        const r = await getJson(`${e.base}/blocks/tip/height`);
        return r.status === 200 ? `${e.name} OK (block ${String(r.body)})` : `${e.name}: HTTP ${r.status}`;
      } catch {
        return `${e.name}: unreachable`;
      }
    }),
  );
  return { ok: results.some((r) => r.includes(" OK ")), detail: results.join(" · ") };
}
