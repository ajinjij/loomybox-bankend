const express = require("express");
const db = require("../db");
const { requireVendor } = require("./vendors");

const router = express.Router();

function serializeBooking(row) {
  return {
    id: row.id,
    category: row.category_slug,
    categoryName: row.category_name,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    date: row.event_date,
    time: row.event_time,
    details: JSON.parse(row.details_json || "{}"),
    status: row.status,
    paymentStatus: row.payment_status,
    amountTotal: row.amount_total,
    amountPaid: row.amount_paid,
    createdAt: row.created_at,
  };
}

const BOOKING_JOIN = `
  SELECT b.*, c.slug AS category_slug, c.name AS category_name, v.name AS vendor_name
  FROM bookings b
  JOIN categories c ON c.id = b.category_id
  JOIN vendors v ON v.id = b.vendor_id
`;

// POST /api/bookings  — a customer submits a booking request
// body: { vendorId, categoryId, customerName, customerEmail, date, time, details, amountTotal }
router.post("/", (req, res) => {
  const { vendorId, categoryId, customerName, customerEmail, date, time, details, amountTotal } =
    req.body || {};

  if (!vendorId || !categoryId || !customerName || !customerEmail || !date) {
    return res.status(400).json({
      error: "vendorId, categoryId, customerName, customerEmail and date are all required",
    });
  }

  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(vendorId);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });

  const info = db
    .prepare(
      `INSERT INTO bookings
        (category_id, vendor_id, customer_name, customer_email, event_date, event_time, details_json, amount_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      categoryId,
      vendorId,
      customerName,
      customerEmail,
      date,
      time || null,
      JSON.stringify(details || {}),
      amountTotal || null
    );

  const row = db.prepare(BOOKING_JOIN + " WHERE b.id = ?").get(info.lastInsertRowid);
  res.status(201).json(serializeBooking(row));
});

// GET /api/bookings/mine — bookings for the logged-in vendor
router.get("/mine", requireVendor, (req, res) => {
  const rows = db
    .prepare(BOOKING_JOIN + " WHERE b.vendor_id = ? ORDER BY b.created_at DESC")
    .all(req.vendorId);
  res.json(rows.map(serializeBooking));
});

// PATCH /api/bookings/:id/status  { status: "accepted" | "declined" }
router.patch("/:id/status", requireVendor, (req, res) => {
  const { status } = req.body || {};
  if (!["accepted", "declined"].includes(status)) {
    return res.status(400).json({ error: "status must be 'accepted' or 'declined'" });
  }
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.vendor_id !== req.vendorId) {
    return res.status(403).json({ error: "This booking does not belong to you" });
  }
  db.prepare("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    req.params.id
  );
  const row = db.prepare(BOOKING_JOIN + " WHERE b.id = ?").get(req.params.id);
  res.json(serializeBooking(row));
});

// POST /api/bookings/:id/pay  { amount } — mock payment, no real payment gateway wired up
router.post("/:id/pay", (req, res) => {
  const { amount } = req.body || {};
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!amount || amount <= 0) return res.status(400).json({ error: "A positive amount is required" });

  const newPaid = booking.amount_paid + Number(amount);
  const paymentStatus =
    booking.amount_total && newPaid >= booking.amount_total ? "paid_in_full" : "deposit_paid";

  db.prepare(
    "UPDATE bookings SET amount_paid = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newPaid, paymentStatus, req.params.id);

  const row = db.prepare(BOOKING_JOIN + " WHERE b.id = ?").get(req.params.id);
  res.json(serializeBooking(row));
});

module.exports = router;
