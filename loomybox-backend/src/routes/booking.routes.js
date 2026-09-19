const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../lib/notifications");

const router = express.Router();

// GET /api/bookings/mine
// Returns bookings for the logged-in customer or vendor.
router.get("/mine", requireAuth, async (req, res) => {
  let where;
  if (req.user.role === "CUSTOMER") {
    where = { customerId: req.user.id };
  } else if (req.user.role === "VENDOR") {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
    where = { vendorId: vendor.id };
  } else {
    return res.status(403).json({ error: "Admins should use /api/admin/bookings" });
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: { payment: true, vendor: true, quote: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(bookings);
});

// GET /api/bookings/:id
router.get("/:id", requireAuth, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: Number(req.params.id) },
    include: { payment: true, vendor: true, quote: true, review: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const vendor = req.user.role === "VENDOR" ? await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } }) : null;
  const owns = booking.customerId === req.user.id || (vendor && booking.vendorId === vendor.id) || req.user.role === "ADMIN";
  if (!owns) return res.status(403).json({ error: "You do not have access to this booking" });

  res.json(booking);
});

// POST /api/bookings/:id/complete
// Vendor: mark the event as delivered. This is what allows escrow funds to be released.
router.post("/:id/complete", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const booking = await prisma.booking.findUnique({ where: { id: Number(req.params.id) } });
  if (!booking || booking.vendorId !== vendor.id) {
    return res.status(404).json({ error: "Booking not found" });
  }
  if (booking.status !== "CONFIRMED") {
    return res.status(400).json({ error: "Only a confirmed, paid booking can be marked complete" });
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "COMPLETED" },
  });

  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { completedBookingsCount: { increment: 1 } },
  });

  await notify(booking.customerId, "REVIEW_REQUEST", "How did it go? Leave a review for your event.", "bookings.html");

  res.json(updated);
});

// POST /api/bookings/:id/dispute
// Customer or vendor: flag a booking for admin review.
router.post("/:id/dispute", requireAuth, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "A dispute reason is required" });

  const booking = await prisma.booking.findUnique({ where: { id: Number(req.params.id) } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "DISPUTED", disputeReason: reason },
  });

  const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
  await Promise.all(admins.map((a) => notify(a.id, "DISPUTE_FILED", `Booking #${booking.id} was disputed: ${reason}`, "admin.html")));

  res.json(updated);
});

// POST /api/bookings/:id/pay-balance
// Customer: pay off the remaining balance on a SPLIT-payment booking.
router.post("/:id/pay-balance", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: Number(req.params.id) },
    include: { payment: true },
  });
  if (!booking || booking.customerId !== req.user.id) {
    return res.status(404).json({ error: "Booking not found" });
  }
  if (booking.balanceDue <= 0) {
    return res.status(400).json({ error: "There's no balance due on this booking" });
  }

  const [payment] = await prisma.$transaction([
    prisma.payment.update({
      where: { bookingId: booking.id },
      data: { amountPaid: { increment: booking.balanceDue } },
    }),
    prisma.booking.update({ where: { id: booking.id }, data: { balanceDue: 0 } }),
  ]);
  res.json(payment);
});

module.exports = router;
