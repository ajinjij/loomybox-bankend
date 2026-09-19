const express = require("express");
const { pool } = require("../db");
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

async function fetchBooking(id) {
  const { rows } = await pool.query(BOOKING_JOIN + " WHERE b.id = $1", [id]);
  return rows[0];
}

// POST /api/bookings — a customer submits a booking request
router.post("/", async (req, res, next) => {
  try {
    const { vendorId, categoryId, customerName, customerEmail, date, time, details, amountTotal } =
      req.body || {};

    if (!vendorId || !categoryId || !customerName || !customerEmail || !date) {
      return res.status(400).json({
        error: "vendorId, categoryId, customerName, customerEmail and date are all required",
      });
    }

    const vendorRes = await pool.query("SELECT id FROM vendors WHERE id = $1", [vendorId]);
    if (!vendorRes.rows[0]) return res.status(404).json({ error: "Vendor not found" });

    const insert = await pool.query(
      `INSERT INTO bookings
        (category_id, vendor_id, customer_name, customer_email, event_date, event_time, details_json, amount_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        categoryId,
        vendorId,
        customerName,
        customerEmail,
        date,
        time || null,
        JSON.stringify(details || {}),
        amountTotal || null,
      ]
    );

    res.status(201).json(serializeBooking(await fetchBooking(insert.rows[0].id)));
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/mine — bookings for the logged-in vendor
router.get("/mine", requireVendor, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      BOOKING_JOIN + " WHERE b.vendor_id = $1 ORDER BY b.created_at DESC",
      [req.vendorId]
    );
    res.json(rows.map(serializeBooking));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/status  { status: "accepted" | "declined" }
router.patch("/:id/status", requireVendor, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["accepted", "declined"].includes(status)) {
      return res.status(400).json({ error: "status must be 'accepted' or 'declined'" });
    }
    const booking = await fetchBooking(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.vendor_id !== req.vendorId) {
      return res.status(403).json({ error: "This booking does not belong to you" });
    }
    await pool.query("UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2", [
      status,
      req.params.id,
    ]);
    res.json(serializeBooking(await fetchBooking(req.params.id)));
  } catch (err) {
    next(err);
  }
});

// POST /api/bookings/:id/pay  { amount } — mock payment, no real gateway wired up
router.post("/:id/pay", async (req, res, next) => {
  try {
    const { amount } = req.body || {};
    const booking = await fetchBooking(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "A positive amount is required" });
    }

    const newPaid = Number(booking.amount_paid) + Number(amount);
    const paymentStatus =
      booking.amount_total && newPaid >= Number(booking.amount_total)
        ? "paid_in_full"
        : "deposit_paid";

    await pool.query(
      "UPDATE bookings SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3",
      [newPaid, paymentStatus, req.params.id]
    );

    res.json(serializeBooking(await fetchBooking(req.params.id)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
