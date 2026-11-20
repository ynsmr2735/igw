/**
 * Formatting shared by the server and the browser.
 * A fixed locale and time zone make server and client render identical text
 * (otherwise React reports a hydration mismatch, error #418).
 */
export const DISPLAY_TIME_ZONE = "Europe/Istanbul";

export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** "12345678" -> "1234 5678" for reading; copy the raw value. */
export function formatAccountNumber(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4)}` : value;
}

export function shortHash(value: string, size = 10): string {
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-size)}` : value;
}

export const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  reviewing: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const TX_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const TX_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer_out: "Money sent",
  transfer_in: "Money received",
  // Entries from the earlier demo version of the wallet.
  topup: "Top up (legacy)",
  withdraw: "Withdrawal (legacy)",
  exchange: "Exchange (legacy)",
  transfer: "Transfer (legacy)",
};
