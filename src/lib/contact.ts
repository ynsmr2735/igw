/**
 * Site contact details (email, phone, WhatsApp, Telegram, address, working hours).
 * Stored in the database (app_settings), readable by everyone, editable by an admin.
 * Shared by server and browser code — no secrets here.
 */

export type ContactInfo = {
  email: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  address: string;
  hours: string;
  updatedAt: string | null;
};

export const EMPTY_CONTACT: ContactInfo = {
  email: "",
  phone: "",
  whatsapp: "",
  telegram: "",
  address: "",
  hours: "",
  updatedAt: null,
};

export function toContact(raw: unknown): ContactInfo {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CONTACT };
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    email: str(r.email),
    phone: str(r.phone),
    whatsapp: str(r.whatsapp),
    telegram: str(r.telegram),
    address: str(r.address),
    hours: str(r.hours),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

export function hasContact(c: ContactInfo): boolean {
  return Boolean(c.email || c.phone || c.whatsapp || c.telegram || c.address || c.hours);
}

/** Links for the contact channels (only for filled-in values). */
export function contactLinks(c: ContactInfo) {
  const digits = (v: string) => v.replace(/[^0-9+]/g, "");
  const tg = c.telegram.startsWith("https://t.me/") ? c.telegram : `https://t.me/${c.telegram.replace(/^@/, "")}`;
  const tgLabel = c.telegram.startsWith("https://t.me/") ? "@" + c.telegram.slice("https://t.me/".length) : c.telegram.startsWith("@") ? c.telegram : "@" + c.telegram;
  return [
    c.email && { kind: "email" as const, label: c.email, href: `mailto:${c.email}` },
    c.phone && { kind: "phone" as const, label: c.phone, href: `tel:${digits(c.phone)}` },
    c.whatsapp && { kind: "whatsapp" as const, label: c.whatsapp, href: `https://wa.me/${digits(c.whatsapp).replace(/^\+/, "")}` },
    c.telegram && { kind: "telegram" as const, label: tgLabel, href: tg },
  ].filter(Boolean) as { kind: "email" | "phone" | "whatsapp" | "telegram"; label: string; href: string }[];
}

/** "Forgot / change password" on the sign-in page: WhatsApp chat with a prefilled message. */
export type PasswordHelp = { kind: "whatsapp"; number: string } | { kind: "contact"; href: string } | null;

export function passwordHelp(c: ContactInfo): PasswordHelp {
  const digits = c.whatsapp.replace(/[^0-9]/g, "");
  if (digits.length >= 6) return { kind: "whatsapp", number: digits };
  if (hasContact(c)) return { kind: "contact", href: "/#contact" };
  return null;
}

export function passwordHelpWhatsAppUrl(number: string, email: string): string {
  const text = `Hello, I would like to reset / change my Insta Global Wallet password.${email ? ` My email: ${email}` : ""}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
