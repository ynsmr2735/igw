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

/**
 * Account numbers: "UK" + 12 digits, stored without spaces ("UK123456712345") and
 * shown as 7 + 5 digits ("UK1234567 12345"). Members who joined before igw-rpc-11 can
 * still be found by their old 8-digit number.
 */
export const ACCOUNT_NUMBER_HINT = "Enter the account number like UK1234567 12345 (UK and 12 digits).";

/** What a member typed -> stored form: upper case, no spaces or dashes. */
export function normalizeAccountNumber(value: string): string {
  return String(value ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

/** Current format (UK123456712345) or an old 8-digit number. Expects a normalized value. */
export function isAccountNumber(value: string): boolean {
  return /^UK\d{12}$/.test(value) || /^\d{8}$/.test(value);
}

/** "UK123456712345" -> "UK1234567 12345" (old "12345678" -> "1234 5678"). */
export function formatAccountNumber(value: string): string {
  if (/^UK\d{12}$/.test(value)) return `${value.slice(0, 9)} ${value.slice(9)}`;
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
