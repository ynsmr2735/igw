import { getSessionToken } from "@/lib/auth/session";
import { validateBitcoinAddress } from "@/lib/btc/address";
import { toCardRequest, toWithdrawal, type CardRequest, type CardTier, type Withdrawal } from "@/lib/cards";
import { AuthError, RpcError, rpc } from "@/lib/supabase";
import { assertSchema } from "@/lib/system";

/** Member side of cards and withdrawals. Every rule is enforced again in the database. */

async function requireToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) throw new AuthError();
  return token;
}

export async function requestCard(tier: CardTier, note: string): Promise<CardRequest> {
  await assertSchema();
  const raw = await rpc<Record<string, unknown>>("igw_card_request", { p_token: await requireToken(), p_tier: tier, p_note: note });
  return toCardRequest(raw)!;
}

export async function cancelCardRequest(id: number): Promise<CardRequest> {
  const raw = await rpc<Record<string, unknown>>("igw_card_request_cancel", { p_token: await requireToken(), p_id: id });
  return toCardRequest(raw)!;
}

export async function createWithdrawal(amountUsd: number, btcAddress: string): Promise<Withdrawal> {
  await assertSchema();
  const check = validateBitcoinAddress(btcAddress);
  if (!check.valid) throw new RpcError(`Invalid Bitcoin address: ${check.reason}.`);
  const raw = await rpc<Record<string, unknown>>("igw_withdrawal_create", {
    p_token: await requireToken(),
    p_amount_usd: amountUsd,
    p_btc_address: check.address,
  });
  return toWithdrawal(raw);
}

export async function cancelWithdrawal(id: number): Promise<Withdrawal> {
  const raw = await rpc<Record<string, unknown>>("igw_withdrawal_cancel", { p_token: await requireToken(), p_id: id });
  return toWithdrawal(raw);
}
