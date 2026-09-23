const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "loomybox.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  deposit_required INTEGER NOT NULL DEFAULT 0,
  deposit_percent INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 5.0,
  price_from REAL NOT NULL,
  price_unit TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_time TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  amount_total REAL,
  amount_paid REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (count > 0) return;

  const insertCategory = db.prepare(
    `INSERT INTO categories (slug, name, deposit_required, deposit_percent) VALUES (?, ?, ?, ?)`
  );
  const categories = [
    ["photo", "Photography", 0, 0],
    ["catering", "Catering", 1, 25],
    ["hamper", "Hampers", 0, 0],
    ["local", "Local events", 1, 20],
    ["bus", "Tourist bus", 1, 20],
    ["wedding", "Wedding", 1, 20],
    ["birthday", "Birthday parties", 1, 20],
  ];
  const catIds = {};
  for (const [slug, name, dep, pct] of categories) {
    const info = insertCategory.run(slug, name, dep, pct);
    catIds[slug] = info.lastInsertRowid;
  }

  const insertVendor = db.prepare(`
    INSERT INTO vendors (category_id, name, email, password_hash, rating, price_from, price_unit, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const passwordHash = bcrypt.hashSync("vendor123", 8);
  const vendors = [
    [catIds.photo, "Layla's photography", "layla@example.com", 4.9, 450, "per session", "Portrait and event photography across the UAE."],
    [catIds.catering, "Noor catering co.", "noor@example.com", 4.8, 35, "per head", "Arabic and continental menus for events of any size."],
    [catIds.bus, "Al Ain desert coach", "coach@example.com", 4.7, 950, "per day", "Licensed tourist coaches with driver-guides."],
    [catIds.hamper, "Sweet Sands hampers", "sands@example.com", 4.9, 180, "per hamper", "Curated gift hampers for every occasion."],
    [catIds.wedding, "Aisha events", "aisha@example.com", 5.0, 8000, "per package", "Full wedding planning and styling."],
  ];
  for (const [categoryId, name, email, rating, priceFrom, priceUnit, description] of vendors) {
    insertVendor.run(categoryId, name, email, passwordHash, rating, priceFrom, priceUnit, description);
  }

  console.log("Seeded categories and vendors. Vendor login password for all seeded vendors: vendor123");
}

seed();

module.exports = db;
