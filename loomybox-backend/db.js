const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it in Render > Environment.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  deposit_required INTEGER NOT NULL DEFAULT 0,
  deposit_percent INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rating DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  price_from DOUBLE PRECISION NOT NULL,
  price_unit TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_time TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  amount_total DOUBLE PRECISION,
  amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function seed() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM categories");
  if (rows[0].n > 0) return;

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
    const res = await pool.query(
      `INSERT INTO categories (slug, name, deposit_required, deposit_percent)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [slug, name, dep, pct]
    );
    catIds[slug] = res.rows[0].id;
  }

  const passwordHash = bcrypt.hashSync("vendor123", 8);
  const vendors = [
    [catIds.photo, "Layla's photography", "layla@example.com", 4.9, 450, "per session", "Portrait and event photography across the UAE."],
    [catIds.catering, "Noor catering co.", "noor@example.com", 4.8, 35, "per head", "Arabic and continental menus for events of any size."],
    [catIds.bus, "Al Ain desert coach", "coach@example.com", 4.7, 950, "per day", "Licensed tourist coaches with driver-guides."],
    [catIds.hamper, "Sweet Sands hampers", "sands@example.com", 4.9, 180, "per hamper", "Curated gift hampers for every occasion."],
    [catIds.wedding, "Aisha events", "aisha@example.com", 5.0, 8000, "per package", "Full wedding planning and styling."],
  ];

  for (const [categoryId, name, email, rating, priceFrom, priceUnit, description] of vendors) {
    await pool.query(
      `INSERT INTO vendors (category_id, name, email, password_hash, rating, price_from, price_unit, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [categoryId, name, email, passwordHash, rating, priceFrom, priceUnit, description]
    );
  }

  console.log("Seeded categories and vendors. Seeded vendor password: vendor123");
}

async function initDb() {
  await pool.query(SCHEMA);
  await seed();
  console.log("Database ready");
}

module.exports = { pool, initDb };
