import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 180 }).notNull().unique(),
  plan: varchar("plan", { length: 40 }).notNull().default("Global Plus"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  currency: varchar("currency", { length: 3 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  accountNumber: varchar("account_number", { length: 40 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
});

export const recipients = pgTable("recipients", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 180 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  walletId: integer("wallet_id").references(() => wallets.id),
  color: varchar("color", { length: 30 }).notNull().default("#7F00FF"),
});

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  label: varchar("label", { length: 100 }).notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  brand: varchar("brand", { length: 30 }).notNull().default("Visa"),
  type: varchar("type", { length: 40 }).notNull().default("Sanal kart"),
  expiry: varchar("expiry", { length: 7 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  theme: varchar("theme", { length: 30 }).notNull().default("violet"),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => wallets.id),
  type: varchar("type", { length: 24 }).notNull(),
  direction: varchar("direction", { length: 4 }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  counterparty: varchar("counterparty", { length: 160 }).notNull(),
  note: text("note").notNull().default(""),
  status: varchar("status", { length: 20 }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
