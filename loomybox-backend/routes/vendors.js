const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// GET /api/vendors?category=catering
router.get("/", (req, res) => {
  const { category } = req.query;
  let vendors;
  if (category) {
    vendors = db
      .prepare(
        `SELECT v.id, v.name, v.rating, v.price_from, v.price_unit, v.description, c.slug AS category, c.name AS category_name
         FROM vendors v JOIN categories c ON c.id = v.category_id
         WHERE c.slug = ? ORDER BY v.rating DESC`
      )
      .all(category);
  } else {
    vendors = db
      .prepare(
        `SELECT v.id, v.name, v.rating, v.price_from, v.price_unit, v.description, c.slug AS category, c.name AS category_name
         FROM vendors v JOIN categories c ON c.id = v.category_id ORDER BY v.rating DESC`
      )
      .all();
  }
  res.json(vendors);
});

// GET /api/vendors/:id
router.get("/:id", (req, res) => {
  const vendor = db
    .prepare(
      `SELECT v.id, v.name, v.rating, v.price_from, v.price_unit, v.description, v.category_id,
              c.slug AS category, c.name AS category_name
       FROM vendors v JOIN categories c ON c.id = v.category_id WHERE v.id = ?`
    )
    .get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  res.json(vendor);
});

// POST /api/vendors/login  { email, password }
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const vendor = db.prepare("SELECT * FROM vendors WHERE email = ?").get(email);
  if (!vendor || !bcrypt.compareSync(password, vendor.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign({ vendorId: vendor.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    token,
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email },
  });
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
