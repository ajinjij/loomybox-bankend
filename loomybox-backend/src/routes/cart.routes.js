const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateCoupon } = require("../lib/coupon");
const { notify } = require("../lib/notifications");

const router = express.Router();
const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.12);

// Every route here is for a logged-in customer building/checking out their cart.
router.use(requireAuth, requireRole("CUSTOMER"));

/**
 * Fetches the customer's cart, creating an empty one on first use so the
 * frontend never has to special-case "no cart yet".
 */
async function getOrCreateCart(customerId) {
  let cart = await prisma.cart.findUnique({
    where: { customerId },
    include: { items: { include: { package: { include: { vendor: true } } } } },
  });
  if (!cart) {
    cart = await prisma.cart.create({
      data: { customerId },
      include: { items: { include: { package: { include: { vendor: true } } } } },
    });
  }
  return cart;
}

// GET /api/cart
router.get("/", async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  res.json(cart);
});

// POST /api/cart/items
// Body: { packageId, eventDate?, notes? }
router.post("/items", async (req, res) => {
  const { packageId, eventDate, notes } = req.body;
  if (!packageId) return res.status(400).json({ error: "packageId is required" });

  const pkg = await prisma.package.findUnique({ where: { id: Number(packageId) }, include: { vendor: true } });
  if (!pkg || pkg.vendor.status !== "APPROVED") {
    return res.status(404).json({ error: "Package not found" });
  }

  const cart = await getOrCreateCart(req.user.id);

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_packageId: { cartId: cart.id, packageId: pkg.id } },
  });
  if (existing) {
    return res.status(409).json({ error: "This package is already in your cart" });
  }

  const item = await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      packageId: pkg.id,
      eventDate: eventDate ? new Date(eventDate) : null,
      notes,
    },
    include: { package: { include: { vendor: true } } },
  });
  res.status(201).json(item);
});

// PUT /api/cart/items/:itemId
// Update the event date/notes for a cart item (e.g. before checkout).
router.put("/items/:itemId", async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const item = cart.items.find((i) => i.id === Number(req.params.itemId));
  if (!item) return res.status(404).json({ error: "Cart item not found" });

  const { eventDate, notes } = req.body;
  const updated = await prisma.cartItem.update({
    where: { id: item.id },
    data: {
      eventDate: eventDate ? new Date(eventDate) : item.eventDate,
      notes: notes !== undefined ? notes : item.notes,
    },
    include: { package: { include: { vendor: true } } },
  });
  res.json(updated);
});

// DELETE /api/cart/items/:itemId
router.delete("/items/:itemId", async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const item = cart.items.find((i) => i.id === Number(req.params.itemId));
  if (!item) return res.status(404).json({ error: "Cart item not found" });

  await prisma.cartItem.delete({ where: { id: item.id } });
  res.status(204).send();
});

// POST /api/cart/preview-coupon
// Body: { code }. Validates a coupon against the current cart subtotal
// without redeeming it, so the cart page can show "You saved ₹X" before checkout.
router.post("/preview-coupon", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });

  const cart = await getOrCreateCart(req.user.id);
  const subtotal = cart.items.reduce((sum, i) => sum + i.package.price, 0);

  try {
    const { discountAmount } = await validateCoupon(code, subtotal);
    res.json({ valid: true, code: code.toUpperCase(), discountAmount, subtotal });
  } catch (err) {
    res.status(400).json({ valid: false, error: err.message });
  }
});

// POST /api/cart/checkout
// Turns every item in the cart into a booking and captures payment for all of
// them in one go - the "Buy Now" moment. In production, swap the payment
// capture block for a real gateway call and only mark bookings CONFIRMED
// once the gateway confirms the charge.
// Body: { couponCode?, paymentPlan? } - paymentPlan is "FULL" (default) or "SPLIT" (50% now, 50% before the event).
router.post("/checkout", async (req, res) => {
  const { couponCode, paymentPlan } = req.body;
  const plan = paymentPlan === "SPLIT" ? "SPLIT" : "FULL";

  const cart = await getOrCreateCart(req.user.id);
  if (cart.items.length === 0) {
    return res.status(400).json({ error: "Your cart is empty" });
  }

  const subtotal = cart.items.reduce((sum, i) => sum + i.package.price, 0);

  let discountAmount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    try {
      const result = await validateCoupon(couponCode, subtotal);
      discountAmount = result.discountAmount;
      appliedCoupon = result.coupon;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const createdBookings = [];
  let grandTotal = 0;
  let grandPaidNow = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of cart.items) {
      // Spread the coupon's discount across items proportionally to their share of the cart.
      const itemShare = subtotal > 0 ? item.package.price / subtotal : 0;
      const itemDiscount = Number((discountAmount * itemShare).toFixed(2));
      const discountedPrice = Math.max(0, item.package.price - itemDiscount);

      const commissionAmount = Number((discountedPrice * COMMISSION_RATE).toFixed(2));
      const totalAmount = Number((discountedPrice + commissionAmount).toFixed(2));
      const paidNow = plan === "SPLIT" ? Number((totalAmount / 2).toFixed(2)) : totalAmount;
      const balanceDue = Number((totalAmount - paidNow).toFixed(2));

      const booking = await tx.booking.create({
        data: {
          packageId: item.packageId,
          customerId: req.user.id,
          vendorId: item.package.vendorId,
          totalAmount,
          commissionAmount,
          eventDate: item.eventDate,
          status: "CONFIRMED", // paid immediately, see note above about real gateways
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          discountAmount: itemDiscount,
          paymentPlan: plan,
          balanceDue,
        },
      });
      await tx.payment.create({
        data: { bookingId: booking.id, amountPaid: paidNow, status: "HELD" },
      });

      createdBookings.push(booking);
      grandTotal += totalAmount;
      grandPaidNow += paidNow;
    }

    if (appliedCoupon) {
      await tx.coupon.update({ where: { id: appliedCoupon.id }, data: { usedCount: { increment: 1 } } });
    }

    // Empty the cart now that everything in it has become a real booking.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
  });

  // Notify each vendor involved that they have a new confirmed booking.
  const vendorIds = [...new Set(createdBookings.map((b) => b.vendorId))];
  const vendors = await prisma.vendorProfile.findMany({ where: { id: { in: vendorIds } } });
  await Promise.all(vendors.map((v) => notify(v.userId, "BOOKING_CONFIRMED", "You have a new confirmed booking — funds are held in escrow.", "vendor-dashboard.html")));

  res.status(201).json({
    message: `${createdBookings.length} booking(s) confirmed`,
    totalAmount: Number(grandTotal.toFixed(2)),
    totalPaid: Number(grandPaidNow.toFixed(2)),
    discountAmount,
    paymentPlan: plan,
    bookings: createdBookings,
  });
});

module.exports = router;
