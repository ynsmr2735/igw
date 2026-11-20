import { Clock, Mail, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import { contactLinks, hasContact, type ContactInfo } from "@/lib/contact";

const ICON = { email: Mail, phone: Phone, whatsapp: MessageCircle, telegram: Send } as const;
const LABEL = { email: "Email", phone: "Phone", whatsapp: "WhatsApp", telegram: "Telegram" } as const;

/**
 * Contact channels set by the admin (Admin → Contact details). Renders nothing when
 * no contact detail has been entered yet. Works in server and client components.
 */
export function ContactDetails({ contact, tone = "light" }: { contact: ContactInfo; tone?: "light" | "card" }) {
  if (!hasContact(contact)) return null;
  const links = contactLinks(contact);
  const box =
    tone === "card"
      ? "flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5"
      : "flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm";
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="contact-details">
      {links.map((l) => {
        const Icon = ICON[l.kind];
        const external = l.kind === "whatsapp" || l.kind === "telegram";
        return (
          <a
            key={l.kind}
            href={l.href}
            className={`${box} transition hover:border-purple-200`}
            data-testid={`contact-${l.kind}`}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#7F00FF]">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-slate-500">{LABEL[l.kind]}</span>
              <span className="block break-all text-[13px] font-bold text-[#10152b]">{l.label}</span>
            </span>
          </a>
        );
      })}
      {contact.address && (
        <div className={box} data-testid="contact-address">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#7F00FF]">
            <MapPin className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-slate-500">Address</span>
            <span className="block whitespace-pre-line text-[13px] font-bold text-[#10152b]">{contact.address}</span>
          </span>
        </div>
      )}
      {contact.hours && (
        <div className={box} data-testid="contact-hours">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#7F00FF]">
            <Clock className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-slate-500">Support hours</span>
            <span className="block text-[13px] font-bold text-[#10152b]">{contact.hours}</span>
          </span>
        </div>
      )}
    </div>
  );
}
