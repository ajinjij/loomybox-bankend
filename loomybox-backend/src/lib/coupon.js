const prisma = require("./prisma");

/**
 * Validates a coupon code against a cart subtotal and returns the discount
 * it would apply. Throws a plain Error with a human-readable message if the
 * coupon can't be used, so routes can just catch and return it as a 400.
 * Does NOT increment usedCount - that only happens at actual checkout,
 * inside the same transaction as booking creation, so a preview never
 * consumes a redemption.
 */
async function validateCoupon(code, subtotal) {
  if (!code) return null;

  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!coupon) throw new Error("This coupon code doesn't exist");
  if (!coupon.active) throw new Error("This coupon is no longer active");
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new Error("This coupon has expired");
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) throw new Error("This coupon has reached its usage limit");
  if (coupon.minOrder && subtotal < coupon.minOrder) {
    throw new Error(`This coupon needs a minimum order of ₹${coupon.minOrder.toLocaleString("en-IN")}`);
  }

  const discountAmount =
    coupon.type === "PERCENT"
      ? Number(((subtotal * coupon.value) / 100).toFixed(2))
      : Math.min(coupon.value, subtotal); // a flat discount can never exceed the order total

  return { coupon, discountAmount };
}

module.exports = { validateCoupon };
