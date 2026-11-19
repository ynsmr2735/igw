// Mirrors supabase/schema.sql. That SQL file is the source of truth:
// run it in the Supabase SQL Editor instead of `drizzle-kit push`.
import {
  bigint,
  boolean,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  plan: text("plan").notNull().default("Global Plus"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable("wallets", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  currency: text("currency").notNull(),
  name: text("name").notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  accountNumber: text("account_number").notNull().unique(),
  isPrimary: boolean("is_primary").notNull().default(false),
});

export const recipients = pgTable("recipients", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  currency: text("currency").notNull().default("USD"),
  walletId: bigint("wallet_id", { mode: "number" }).references(() => wallets.id, {
    onDelete: "set null",
  }),
  color: text("color").notNull().default("#7F00FF"),
});

export const cards = pgTable("cards", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  last4: text("last4").notNull(),
  brand: text("brand").notNull().default("Visa"),
  type: text("type").notNull().default("Virtual card"),
  expiry: text("expiry").notNull(),
  status: text("status").notNull().default("active"),
  theme: text("theme").notNull().default("violet"),
});

export const transactions = pgTable("transactions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  walletId: bigint("wallet_id", { mode: "number" })
    .notNull()
    .references(() => wallets.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  counterparty: text("counterparty").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
