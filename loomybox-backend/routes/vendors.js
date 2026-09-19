const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Add it in Render > Environment.");
}

const VENDOR_SELECT = `
  SELECT v.id, v.name, v.rating, v.price_from, v.price_unit, v.description,
         c.slug AS category, c.name AS category_name
  FROM vendors v JOIN categories c ON c.id = v.category_id
`;

// GET /api/vendors?category=catering
router.get("/", async (req, res, next) => {
  try {
    const { category } = req.query;
    const { rows } = category
      ? await pool.query(VENDOR_SELECT + " WHERE c.slug = $1 ORDER BY v.rating DESC", [category])
      : await pool.query(VENDOR_SELECT + " ORDER BY v.rating DESC");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/vendors/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(VENDOR_SELECT + " WHERE v.id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Vendor not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/vendors/login  { email, password }
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const { rows } = await pool.query("SELECT * FROM vendors WHERE email = $1", [email]);
    const vendor = rows[0];
    if (!vendor || !bcrypt.compareSync(password, vendor.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign({ vendorId: vendor.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      vendor: { id: vendor.id, name: vendor.name, email: vendor.email },
    });
  } catch (err) {
    next(err);
  }
});

// Middleware other routes can reuse to require a logged-in vendor
function requireVendor(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.vendorId = payload.vendorId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { router, requireVendor };
