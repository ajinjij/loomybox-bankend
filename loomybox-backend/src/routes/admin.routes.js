const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../lib/notifications");

const router = express.Router();

// Every route in this file is admin-only.
router.use(requireAuth, requireRole("ADMIN"));

// GET /api/admin/vendors/pending
router.get("/vendors/pending", async (req, res) => {
  const vendors = await prisma.vendorProfile.findMany({
    where: { status: "PENDING" },
    include: { user: { select: { name: true, email: true, createdAt: true } } },
  });
  res.json(vendors);
});

// POST /api/admin/vendors/:id/approve
router.post("/vendors/:id/approve", async (req, res) => {
  const vendor = await prisma.vendorProfile.update({
    where: { id: Number(req.params.id) },
    data: { status: "APPROVED" },
  });
  await notify(vendor.userId, "VENDOR_APPROVED", "Your vendor account has been approved — you can now list packages and send quotes.", "vendor-dashboard.html");
  res.json(vendor);
});

// POST /api/admin/vendors/:id/reject
router.post("/vendors/:id/reject", async (req, res) => {
  const vendor = await prisma.vendorProfile.update({
    where: { id: Number(req.params.id) },
    data: { status: "REJECTED" },
  });
  res.json(vendor);
});

// GET /api/admin/bookings/disputed
router.get("/bookings/disputed", async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { status: "DISPUTED" },
    include: { customer: { select: { name: true, email: true } }, vendor: true, payment: true },
  });
  res.json(bookings);
});

// GET /api/admin/stats
// Powers the admin dashboard cards: commission earned, active bookings, open disputes.
router.get("/stats", async (req, res) => {
  const [commissionAgg, activeBookings, openDisputes] = await Promise.all([
    prisma.booking.aggregate({
      _sum: { commissionAmount: true },
      where: { status: { in: ["CONFIRMED", "COMPLETED"] } },
    }),
    prisma.booking.count({ where: { status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    prisma.booking.count({ where: { status: "DISPUTED" } }),
  ]);

  res.json({
    totalCommission: commissionAgg._sum.commissionAmount || 0,
    activeBookings,
    openDisputes,
  });
});

// GET /api/admin/coupons
router.get("/coupons", async (req, res) => {
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
  res.json(coupons);
});

// POST /api/admin/coupons
// Body: { code, type: "PERCENT"|"FLAT", value, minOrder?, maxUses?, expiresAt? }
router.post("/coupons", async (req, res) => {
  const { code, type, value, minOrder, maxUses, expiresAt } = req.body;
  if (!code || !type || value == null) {
    return res.status(400).json({ error: "code, type, and value are required" });
  }
  if (!["PERCENT", "FLAT"].includes(type)) {
    return res.status(400).json({ error: "type must be PERCENT or FLAT" });
  }

  try {
    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        type,
        value: Number(value),
        minOrder: minOrder ? Number(minOrder) : null,
        maxUses: maxUses ? Number(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    res.status(201).json(coupon);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A coupon with this code already exists" });
    throw err;
  }
});

// PATCH /api/admin/coupons/:id
// Toggle a coupon active/inactive rather than deleting it, so past bookings keep an accurate record.
router.patch("/coupons/:id", async (req, res) => {
  const { active } = req.body;
  const coupon = await prisma.coupon.update({
    where: { id: Number(req.params.id) },
    data: { active: Boolean(active) },
  });
  res.json(coupon);
});

// GET /api/admin/settings
// Same shape as the public /api/settings, but admin-only so the settings page can show current values to edit.
router.get("/settings", async (req, res) => {
  const rows = await prisma.setting.findMany();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

// PUT /api/admin/settings
// Body: { key: value, key2: value2, ... } - upserts each setting provided.
// This is what lets the admin change site branding/copy without touching code.
router.put("/settings", async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) return res.status(400).json({ error: "No settings provided" });

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  );

  const rows = await prisma.setting.findMany();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

// GET /api/admin/flags
// Lightweight, rules-based quality/fraud signals for admin review — not ML,
// just heuristics worth a human look. Cheap to run; expand the rules here as
// patterns emerge.
router.get("/flags", async (req, res) => {
  const flags = [];

  // Vendors with repeated disputes.
  const disputedBookings = await prisma.booking.findMany({
    where: { status: "DISPUTED" },
    select: { vendorId: true },
  });
  const disputeCounts = {};
  for (const b of disputedBookings) disputeCounts[b.vendorId] = (disputeCounts[b.vendorId] || 0) + 1;
  const flaggedVendorIds = Object.entries(disputeCounts).filter(([, count]) => count >= 2).map(([id]) => Number(id));
  if (flaggedVendorIds.length) {
    const vendors = await prisma.vendorProfile.findMany({ where: { id: { in: flaggedVendorIds } } });
    for (const v of vendors) {
      flags.push({
        type: "REPEAT_DISPUTES",
        vendorId: v.id,
        vendorName: v.businessName,
        detail: `${disputeCounts[v.id]} disputed bookings`,
      });
    }
  }

  // Packages priced far above the median for their category (possible pricing error or scam listing).
  const packages = await prisma.package.findMany({ include: { vendor: true } });
  const byCategory = {};
  for (const p of packages) {
    if (!byCategory[p.vendor.category]) byCategory[p.vendor.category] = [];
    byCategory[p.vendor.category].push(p.price);
  }
  for (const p of packages) {
    const prices = [...byCategory[p.vendor.category]].sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    if (median > 0 && p.price > median * 3 && prices.length >= 4) {
      flags.push({
        type: "PRICE_OUTLIER",
        packageId: p.id,
        packageName: p.name,
        vendorName: p.vendor.businessName,
        detail: `₹${p.price.toLocaleString("en-IN")} vs. category median ₹${median.toLocaleString("en-IN")}`,
      });
    }
  }

  // Vendors approved but with zero packages listed after a while (possible dead/abandoned account).
  const staleVendors = await prisma.vendorProfile.findMany({
    where: {
      status: "APPROVED",
      packages: { none: {} },
      createdAt: { lt: new Date(Date.now() - 14 * 86400000) },
    },
  });
  for (const v of staleVendors) {
    flags.push({ type: "INACTIVE_VENDOR", vendorId: v.id, vendorName: v.businessName, detail: "Approved 14+ days ago, no packages listed yet" });
  }

  res.json(flags);
});

module.exports = router;
