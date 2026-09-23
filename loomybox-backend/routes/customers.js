const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/customers/signup  { name, email, password }
router.post("/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !isValidEmail(email) || !password || password.length < 6) {
    return res.status(400).json({
      error: "A name, a valid email, and a password of at least 6 characters are required",
    });
  }
  const existing = db.prepare("SELECT id FROM customers WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  const passwordHash = bcrypt.hashSync(password, 8);
  const info = db
    .prepare("INSERT INTO customers (name, email, password_hash) VALUES (?, ?, ?)")
    .run(name, email, passwordHash);

  const token = jwt.sign({ customerId: info.lastInsertRowid }, JWT_SECRET, { expiresIn: "30d" });
  res.status(201).json({ token, customer: { id: info.lastInsertRowid, name, email } });
});

// POST /api/customers/login  { email, password }
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const customer = db.prepare("SELECT * FROM customers WHERE email = ?").get(email);
  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign({ customerId: customer.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, customer: { id: customer.id, name: customer.name, email: customer.email } });
});

// Middleware other routes can reuse to require a logged-in customer
function requireCustomer(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.customerId) throw new Error("not a customer token");
    req.customerId = payload.customerId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Same middleware, but doesn't reject the request if there's no token —
// used on the booking-creation route so guest checkout still works.
function attachCustomerIfPresent(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.customerId) req.customerId = payload.customerId;
  } catch {
    /* invalid/expired token on an optional route — just proceed as a guest */
  }
  next();
}

module.exports = { router, requireCustomer, attachCustomerIfPresent };
