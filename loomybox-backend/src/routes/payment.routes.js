const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../lib/notifications");

const router = express.Router();

/**
 * NOTE: This simulates an escrow payment flow so the booking lifecycle works
 * end to end. In production, replace the body of POST /:bookingId/pay with a
 * real gateway call (e.g. Razorpay Route or Stripe Connect with
 * transfer_group / on_behalf_of), and only mark the payment HELD once the
 * gateway confirms the charge via its webhook - not immediately on request.
 */

// POST /api/payments/:bookingId/pay
// Customer: pay for a booking. Funds are recorded as HELD (in escrow), not yet
// paid out to the vendor. This confirms the booking.
router.post("/:bookingId/pay", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: Number(req.params.bookingId) } });
  if (!booking || booking.customerId !== req.user.id) {
    return res.status(404).json({ error: "Booking not found" });
  }
  if (booking.status !== "PENDING_PAYMENT") {
    return res.status(400).json({ error: "This booking is not awaiting payment" });
  }

  const [payment] = await prisma.$transaction([
    prisma.payment.create({
      data: { bookingId: booking.id, amountPaid: booking.totalAmount, status: "HELD" },
    }),
    prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } }),
  ]);

  const vendor = await prisma.vendorProfile.findUnique({ where: { id: booking.vendorId } });
  if (vendor) await notify(vendor.userId, "BOOKING_CONFIRMED", `A booking (#${booking.id}) is confirmed and paid — funds are held in escrow.`, "vendor-dashboard.html");

  res.status(201).json(payment);
});

// POST /api/payments/:bookingId/release
// Admin: release escrowed funds to the vendor once the booking is COMPLETED.
// In a real integration this is where you'd trigger the payout/transfer call.
router.post("/:bookingId/release", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: Number(req.params.bookingId) },
    include: { payment: true },
  });
  if (!booking || !booking.payment) return res.status(404).json({ error: "Booking or payment not found" });
  if (booking.status !== "COMPLETED" && booking.status !== "DISPUTED") {
    return res.status(400).json({ error: "Funds can only be released after the vendor marks the event complete, or when resolving a dispute" });
  }
  if (booking.payment.status !== "HELD") {
    return res.status(400).json({ error: "This payment has already been released or refunded" });
  }

  const [payment] = await prisma.$transaction([
    prisma.payment.update({
      where: { bookingId: booking.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    }),
    prisma.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } }),
  ]);
  res.json(payment);
});

// POST /api/payments/:bookingId/refund
// Admin: refund an escrowed payment (e.g. after resolving a dispute in the customer's favor).
router.post("/:bookingId/refund", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: Number(req.params.bookingId) },
    include: { payment: true },
  });
  if (!booking || !booking.payment) return res.status(404).json({ error: "Booking or payment not found" });
  if (booking.payment.status !== "HELD") {
    return res.status(400).json({ error: "Only a held payment can be refunded" });
  }

  const [payment] = await prisma.$transaction([
    prisma.payment.update({ where: { bookingId: booking.id }, data: { status: "REFUNDED" } }),
    prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } }),
  ]);
  res.json(payment);
});

module.exports = router;
