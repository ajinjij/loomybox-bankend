const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../lib/notifications");

const router = express.Router();
const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.12);

// POST /api/quotes
// Vendor: send a quote against a customer's open requirement.
router.post("/", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const { requirementId, price, message } = req.body;
  if (!requirementId || price == null) {
    return res.status(400).json({ error: "requirementId and price are required" });
  }

  const requirement = await prisma.requirement.findUnique({ where: { id: Number(requirementId) } });
  if (!requirement || requirement.status !== "OPEN") {
    return res.status(400).json({ error: "This requirement is not open for quotes" });
  }

  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  if (vendor.status !== "APPROVED") {
    return res.status(403).json({ error: "Your vendor account must be approved before sending quotes" });
  }

  const quote = await prisma.quote.create({
    data: {
      requirementId: requirement.id,
      vendorId: vendor.id,
      price: Number(price),
      message,
    },
  });

  // Track response time for the "usually replies within X" trust signal on this vendor's cards.
  const responseMinutes = (quote.createdAt.getTime() - requirement.createdAt.getTime()) / 60000;
  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: {
      respondedQuoteCount: { increment: 1 },
      totalResponseMinutes: { increment: Math.max(0, responseMinutes) },
    },
  });

  await notify(requirement.customerId, "QUOTE_RECEIVED", `${vendor.businessName} sent you a quote of ₹${Number(price).toLocaleString("en-IN")}`, "bookings.html");

  res.status(201).json(quote);
});

// POST /api/quotes/:id/accept
// Customer: accept a quote. This closes the requirement and creates a booking
// in PENDING_PAYMENT status - the customer still needs to pay to confirm it.
router.post("/:id/accept", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: { requirement: true, vendor: true },
  });
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (quote.requirement.customerId !== req.user.id) {
    return res.status(403).json({ error: "You can only accept quotes on your own requirements" });
  }
  if (quote.status !== "PENDING") {
    return res.status(400).json({ error: "This quote is no longer pending" });
  }

  const commissionAmount = Number((quote.price * COMMISSION_RATE).toFixed(2));
  const totalAmount = Number((quote.price + commissionAmount).toFixed(2));

  // Accept this quote, reject the others, close the requirement, and open a booking - in one transaction.
  const [booking] = await prisma.$transaction([
    prisma.booking.create({
      data: {
        quoteId: quote.id,
        customerId: req.user.id,
        vendorId: quote.vendorId,
        totalAmount,
        commissionAmount,
        eventDate: quote.requirement.eventDate,
      },
    }),
    prisma.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED" } }),
    prisma.quote.updateMany({
      where: { requirementId: quote.requirementId, id: { not: quote.id } },
      data: { status: "REJECTED" },
    }),
    prisma.requirement.update({ where: { id: quote.requirementId }, data: { status: "BOOKED" } }),
  ]);

  await notify(quote.vendor.userId, "QUOTE_ACCEPTED", `Your quote was accepted — awaiting the customer's payment`, "vendor-dashboard.html");

  res.status(201).json(booking);
});

module.exports = router;
