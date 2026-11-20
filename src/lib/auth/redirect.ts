/**
 * Returns a same-site path to redirect to after sign-in, or "/dashboard".
 *
 * Rejects anything a browser could resolve to another origin:
 * "//evil.com", "/\evil.com" (browsers treat "\" as "/"), "https://…",
 * control characters, and auth pages themselves (would bounce back).
 */
export const DEFAULT_AFTER_LOGIN = "/dashboard";

export function safeNextPath(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_AFTER_LOGIN;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_AFTER_LOGIN;

  try {
    const url = new URL(raw, "https://placeholder.invalid");
    if (url.origin !== "https://placeholder.invalid") return DEFAULT_AFTER_LOGIN;
    if (url.pathname === "/login" || url.pathname === "/signup") return DEFAULT_AFTER_LOGIN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
