import type { DepositVerification, VerificationSource } from "@/lib/payment-methods";
import { USDT_TRC20_CONTRACT, tronAccountHex } from "@/lib/tron/address";

/**
 * Verifies a USDT TRC20 deposit against real TRON MAINNET data (TronGrid, the
 * public TRON API run by the TRON foundation):
 *   - POST https://api.trongrid.io/wallet/gettransactioninfobyid          (full node: latest state)
 *   - POST https://api.trongrid.io/walletsolidity/gettransactioninfobyid  (solidity node: only
 *     irreversible, "solidified" blocks)
 *   - POST https://api.trongrid.io/wallet/getnowblock                     (current block height)
 * An optional TRONGRID_API_KEY (server env) is sent as TRON-PRO-API-KEY for higher rate limits.
 *
 * A deposit matches only if ALL hold:
 *   - the transaction executed successfully (receipt SUCCESS)
 *   - it emitted a Transfer event of the official USDT contract
 *     TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (fake tokens named "USDT" do not count)
 *   - the transfers to the request's deposit address add up to exactly the requested amount
 *   - it was made within the quote window
 *   - it has the required number of confirmations and is solidified (irreversible)
 *   - the full node and the solidity node report the same transfer
 */

const API = "https://api.trongrid.io";
/** a614f803b6fd780986a42c78ec9c7f77e6ded13c = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t without the 0x41 prefix. */
const USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** TRON blocks every ~3 s; block timestamps are exact, small skew allowance only. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const LATE_GRACE_MS = 60 * 60 * 1000;

type TronLog = { address?: string; topics?: string[]; data?: string };
type TronTxInfo = {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  result?: string;
  receipt?: { result?: string };
  log?: TronLog[];
};

export type UsdtDepositToVerify = {
  txid: string;
  address: string;
  amountUnits: number;
  createdAt: string;
  expiresAt: string;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  const key = process.env.TRONGRID_API_KEY?.trim();
  if (key) h["TRON-PRO-API-KEY"] = key;
  return h;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, body: parsed };
}

const strip0x = (value: string) => value.toLowerCase().replace(/^0x/, "");

/** Sum of USDT Transfer events to `toHex` in one transaction (BigInt, 6 decimals). */
function usdtPaidTo(info: TronTxInfo, toHex: string): bigint {
  let total = BigInt(0);
  for (const log of info.log ?? []) {
    const emitter = strip0x(String(log.address ?? "")).replace(/^41(?=[0-9a-f]{40}$)/, "");
    if (emitter !== USDT_CONTRACT_HEX) continue;
    const topics = (log.topics ?? []).map((t) => strip0x(String(t)));
    if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC) continue;
    if (topics[2].slice(-40) !== toHex) continue;
    const data = strip0x(String(log.data ?? ""));
    if (!/^[0-9a-f]{1,64}$/.test(data)) continue;
    total += BigInt(`0x${data}`);
  }
  return total;
}

type NodeView = VerificationSource & { success: boolean; usdtEvent: boolean };

async function checkNode(
  name: string,
  path: string,
  txid: string,
  toHex: string,
  tip: number | null,
): Promise<NodeView> {
  const empty: NodeView = {
    source: name, reachable: false, found: false, paidUnits: 0, confirmed: false,
    blockHeight: null, blockTime: null, confirmations: 0, success: false, usdtEvent: false,
  };
  try {
    const res = await post(path, { value: txid });
    if (res.status !== 200 || typeof res.body !== "object" || res.body === null) return empty;
    const info = res.body as TronTxInfo;
    // Unknown (or not yet solidified) transactions return {}.
    if (!info.id) return { ...empty, reachable: true };
    if (strip0x(info.id) !== txid) return empty;
    const paid = usdtPaidTo(info, toHex);
    const blockHeight = Number.isSafeInteger(info.blockNumber) ? (info.blockNumber as number) : null;
    const success = info.receipt?.result === "SUCCESS" && info.result !== "FAILED";
    return {
      source: name,
      reachable: true,
      found: true,
      paidUnits: paid <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paid) : -1,
      confirmed: blockHeight !== null,
      blockHeight,
      blockTime: typeof info.blockTimeStamp === "number" ? new Date(info.blockTimeStamp).toISOString() : null,
      confirmations: blockHeight !== null && tip !== null && tip >= blockHeight ? tip - blockHeight + 1 : 0,
      success,
      usdtEvent: (info.log ?? []).some(
        (l) => strip0x(String(l.address ?? "")).replace(/^41(?=[0-9a-f]{40}$)/, "") === USDT_CONTRACT_HEX,
      ),
    };
  } catch {
    return empty;
  }
}

async function currentBlock(): Promise<number | null> {
  try {
    const res = await post("/wallet/getnowblock", {});
    const n = (res.body as { block_header?: { raw_data?: { number?: number } } } | null)?.block_header?.raw_data?.number;
    return res.status === 200 && Number.isSafeInteger(n) ? (n as number) : null;
  } catch {
    return null;
  }
}

export async function verifyUsdtTrc20Deposit(
  deposit: UsdtDepositToVerify,
  requiredConfirmations: number,
): Promise<DepositVerification> {
  const txid = deposit.txid.toLowerCase();
  const toHex = tronAccountHex(deposit.address);
  const tip = await currentBlock();
  const [full, solid] = toHex
    ? await Promise.all([
        checkNode("TronGrid full node", "/wallet/gettransactioninfobyid", txid, toHex, tip),
        checkNode("TronGrid solidity node", "/walletsolidity/gettransactioninfobyid", txid, toHex, tip),
      ])
    : [null, null];
  const nodes = [full, solid].filter((n): n is NodeView => n !== null);
  const paidUnits = full?.paidUnits ?? 0;
  const confirmations = full?.confirmations ?? 0;
  const blockTime = full?.blockTime ? new Date(full.blockTime).getTime() : null;
  const created = new Date(deposit.createdAt).getTime();
  const expires = new Date(deposit.expiresAt).getTime();
  const fmt = (units: number) => (units / 1e6).toFixed(6).replace(/0{4}$/, "");

  const checks = [
    {
      label: "Valid TRON deposit address",
      ok: toHex !== null,
      detail: toHex ? deposit.address : `${deposit.address} is not a valid TRON address`,
    },
    {
      label: "TRON network data available",
      ok: Boolean(full?.reachable) && tip !== null,
      detail: full?.reachable && tip !== null
        ? `TronGrid answered (current block ${tip})`
        : "TronGrid could not be reached. Try again later.",
    },
    {
      label: "Transaction found on TRON mainnet",
      ok: Boolean(full?.found),
      detail: full?.found
        ? `Block ${full.blockHeight}`
        : "Transaction ID not found on TRON. It may be wrong, not broadcast yet, or on another network (e.g. ERC20/BEP20).",
    },
    {
      label: "Transaction succeeded",
      ok: Boolean(full?.success),
      detail: full?.found ? (full.success ? "Receipt: SUCCESS" : "The transaction failed or was reverted") : "—",
    },
    {
      label: "Official USDT TRC20 token",
      ok: Boolean(full?.usdtEvent),
      detail: full?.usdtEvent
        ? `Contract ${USDT_TRC20_CONTRACT}`
        : `No transfer of the USDT contract ${USDT_TRC20_CONTRACT} (another token or plain TRX does not count)`,
    },
    {
      label: "Pays the deposit address",
      ok: paidUnits > 0,
      detail: paidUnits > 0 ? deposit.address : `No USDT transfer to ${deposit.address}`,
    },
    {
      label: "Exact amount",
      ok: paidUnits === deposit.amountUnits,
      detail: `Expected ${fmt(deposit.amountUnits)} USDT, received ${fmt(Math.max(paidUnits, 0))} USDT`,
    },
    {
      label: "Paid within the quote window",
      ok: blockTime !== null && blockTime >= created - CLOCK_SKEW_MS && blockTime <= expires + LATE_GRACE_MS,
      detail: blockTime === null
        ? "Not in a block yet"
        : `Block time ${new Date(blockTime).toISOString()} (request ${new Date(created).toISOString()})`,
    },
    {
      label: `At least ${requiredConfirmations} confirmations`,
      ok: confirmations >= requiredConfirmations,
      detail: `${confirmations} confirmation${confirmations === 1 ? "" : "s"}`,
    },
    {
      label: "Solidified (irreversible) and nodes agree",
      ok: Boolean(
        solid?.found && full?.found && solid.paidUnits === full.paidUnits && solid.blockHeight === full.blockHeight
          && solid.success === full.success,
      ),
      detail: solid?.found
        ? `Solidity node: ${fmt(Math.max(solid.paidUnits, 0))} USDT in block ${solid.blockHeight}`
        : "Not solidified yet — wait a minute and check again.",
    },
  ];

  return {
    method: "usdt_trc20",
    network: "tron",
    txid,
    address: deposit.address,
    contract: USDT_TRC20_CONTRACT,
    expectedUnits: deposit.amountUnits,
    paidUnits,
    confirmations,
    requiredConfirmations,
    matched: checks.every((c) => c.ok),
    checks,
    sources: nodes.map(({ success: _s, usdtEvent: _u, ...rest }) => rest),
    checkedAt: new Date().toISOString(),
  };
}
