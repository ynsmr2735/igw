"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Save } from "lucide-react";
import { ContactDetails } from "@/components/ContactDetails";
import { type ContactInfo } from "@/lib/contact";
import { formatDate } from "@/lib/format";
import { Card, SectionTitle, postJson, type Toast } from "@/components/wallet-ui";

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base font-semibold text-slate-800 transition focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]";

const FIELDS: { key: keyof Omit<ContactInfo, "updatedAt">; label: string; placeholder: string; hint: string }[] = [
  { key: "email", label: "Email", placeholder: "support@yourdomain.com", hint: "Shown as a mailto link." },
  { key: "phone", label: "Phone", placeholder: "+90 555 123 45 67", hint: "With country code." },
  { key: "whatsapp", label: "WhatsApp", placeholder: "+90 555 123 45 67", hint: "Opens wa.me chat." },
  { key: "telegram", label: "Telegram", placeholder: "@yoursupport or https://t.me/yoursupport", hint: "Username or t.me link." },
  { key: "hours", label: "Support hours", placeholder: "Mon–Fri 09:00–18:00 (GMT+3)", hint: "Free text, max 120 characters." },
];

/** Admin → Contact details: edit the contact info shown on the homepage and member dashboard. */
export function AdminContactView({ contact, onChanged, notify }: { contact: ContactInfo; onChanged: () => Promise<void>; notify: (t: Toast) => void }) {
  const [form, setForm] = useState<ContactInfo>(contact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(contact), [contact]);

  const dirty = FIELDS.some((f) => form[f.key] !== contact[f.key]) || form.address !== contact.address;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { email, phone, whatsapp, telegram, address, hours } = form;
      await postJson("/api/admin", { action: "setContact", contact: { email, phone, whatsapp, telegram, address, hours } }, "/admin");
      await onChanged();
      notify({ type: "ok", message: "Contact details saved. They are now shown on the website." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <SectionTitle eyebrow="Website" title="Contact details" />
        <form onSubmit={save} className="space-y-4" data-testid="contact-form">
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.key === "telegram" || f.key === "hours" ? "sm:col-span-2" : ""}>
                <label htmlFor={`contact-${f.key}`} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{f.label}</label>
                <input
                  id={`contact-${f.key}`}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  autoCapitalize="none"
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>
              </div>
            ))}
            <div className="sm:col-span-2">
              <label htmlFor="contact-address" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Address</label>
              <textarea
                id="contact-address"
                value={form.address}
                maxLength={300}
                rows={3}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Street, city, country"
                className={`${inputClass} h-auto py-2.5`}
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Leave a field empty to hide it. Changes are saved to the database and recorded in the audit log.</p>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !dirty}
              className="igw-gradient inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save contact details
            </button>
            {contact.updatedAt && <span className="text-[11px] text-slate-400">Last change {formatDate(contact.updatedAt)}</span>}
          </div>
        </form>
      </Card>
      <Card>
        <SectionTitle eyebrow="Preview" title="What visitors see" />
        {FIELDS.some((f) => form[f.key].trim()) || form.address.trim() ? (
          <ContactDetails
            contact={{ ...form, email: form.email.trim(), phone: form.phone.trim(), whatsapp: form.whatsapp.trim(), telegram: form.telegram.trim(), address: form.address.trim(), hours: form.hours.trim() }}
            tone="card"
          />
        ) : (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No contact details yet — the Contact section is hidden on the website.</p>
        )}
      </Card>
    </div>
  );
}
