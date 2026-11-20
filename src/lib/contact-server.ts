import { toContact, EMPTY_CONTACT, type ContactInfo } from "@/lib/contact";
import { rpc } from "@/lib/supabase";

/**
 * Public contact details for the website. Never throws: if Supabase is not configured or
 * the database is not on igw-rpc-10 yet, the site renders without the contact block.
 */
export async function getContactInfo(): Promise<ContactInfo> {
  try {
    return toContact(await rpc<unknown>("igw_contact_info"));
  } catch (error) {
    console.error("Contact details unavailable:", error instanceof Error ? error.message : error);
    return { ...EMPTY_CONTACT };
  }
}
