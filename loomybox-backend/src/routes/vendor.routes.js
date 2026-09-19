const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/vendors?category=wedding&city=Mumbai&district=Ernakulam&pincode=682001
// Public: browse approved vendors, optionally filtered.
router.get("/", async (req, res) => {
  const { category, city, district, pincode } = req.query;
  const vendors = await prisma.vendorProfile.findMany({
    where: {
      status: "APPROVED",
      ...(category ? { category: String(category) } : {}),
      ...(city ? { city: String(city) } : {}),
      ...(district ? { district: String(district) } : {}),
      ...(pincode ? { pincode: { startsWith: String(pincode) } } : {}),
    },
    include: { packages: true },
    orderBy: { rating: "desc" },
  });
  res.json(vendors);
});

// GET /api/vendors/:id
// Public: full profile with packages, for the vendor profile page.
router.get("/:id", async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: Number(req.params.id) },
    include: { packages: true },
  });
  if (!vendor || vendor.status !== "APPROVED") {
    return res.status(404).json({ error: "Vendor not found" });
  }
  res.json(vendor);
});

// GET /api/vendors/:id/availability
// Public: dates this vendor is already booked/unavailable, so the customer
// doesn't pick a date the vendor can't actually deliver on.
router.get("/:id/availability", async (req, res) => {
  const blockedDates = await prisma.blockedDate.findMany({
    where: { vendorId: Number(req.params.id) },
    orderBy: { date: "asc" },
  });
  res.json(blockedDates);
});

// POST /api/vendors/me/availability
// Vendor: block a date on their own calendar. Body: { date, reason? }
router.post("/me/availability", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: "date is required" });

  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  try {
    const blocked = await prisma.blockedDate.create({
      data: { vendorId: vendor.id, date: new Date(date), reason },
    });
    res.status(201).json(blocked);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "That date is already marked unavailable" });
    throw err;
  }
});

// DELETE /api/vendors/me/availability/:blockedDateId
// Vendor: re-open a previously blocked date.
router.delete("/me/availability/:blockedDateId", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const blocked = await prisma.blockedDate.findUnique({ where: { id: Number(req.params.blockedDateId) } });
  if (!blocked || blocked.vendorId !== vendor.id) {
    return res.status(404).json({ error: "Blocked date not found" });
  }
  await prisma.blockedDate.delete({ where: { id: blocked.id } });
  res.status(204).send();
});

// PUT /api/vendors/me
// Vendor: update their own profile (business name, category, city, district, pincode, description).
router.put("/me", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const { businessName, category, city, district, pincode, description } = req.body;
  const vendor = await prisma.vendorProfile.update({
    where: { userId: req.user.id },
    data: { businessName, category, city, district, pincode, description },
  });
  res.json(vendor);
});

// GET /api/vendors/me/profile
// Vendor: fetch their own profile, including pending/rejected status.
router.get("/me/profile", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { userId: req.user.id },
    include: { packages: true },
  });
  res.json(vendor);
});

// POST /api/vendors/me/packages
// Vendor: add a package (e.g. "Signature package", ₹2,20,000).
// imageUrl can be a data URL (base64) sent by the frontend after reading a
// local file, which works fine for a demo without needing S3/Cloudinary set up.
router.post("/me/packages", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const { name, description, price, originalPrice, imageUrl } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: "name and price are required" });
  }
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const pkg = await prisma.package.create({
    data: {
      vendorId: vendor.id,
      name,
      description,
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : null,
      imageUrl,
    },
  });
  res.status(201).json(pkg);
});

// PUT /api/vendors/me/packages/:packageId
// Vendor: edit an existing package's name, description, price, or image.
router.put("/me/packages/:packageId", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const pkg = await prisma.package.findUnique({ where: { id: Number(req.params.packageId) } });
  if (!pkg || pkg.vendorId !== vendor.id) {
    return res.status(404).json({ error: "Package not found" });
  }

  const { name, description, price, originalPrice, imageUrl } = req.body;
  const updated = await prisma.package.update({
    where: { id: pkg.id },
    data: {
      name: name !== undefined ? name : pkg.name,
      description: description !== undefined ? description : pkg.description,
      price: price !== undefined ? Number(price) : pkg.price,
      originalPrice: originalPrice !== undefined ? (originalPrice ? Number(originalPrice) : null) : pkg.originalPrice,
      imageUrl: imageUrl !== undefined ? imageUrl : pkg.imageUrl,
    },
  });
  res.json(updated);
});

// DELETE /api/vendors/me/packages/:packageId
router.delete("/me/packages/:packageId", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const pkg = await prisma.package.findUnique({ where: { id: Number(req.params.packageId) } });
  if (!pkg || pkg.vendorId !== vendor.id) {
    return res.status(404).json({ error: "Package not found" });
  }
  await prisma.package.delete({ where: { id: pkg.id } });
  res.status(204).send();
});

// POST /api/vendors/me/packages/:packageId/images
// Vendor: add a photo to a package's gallery (beyond the single cover imageUrl).
// Body: { imageUrl } — same data-URL-or-hosted-URL convention as the cover image.
router.post("/me/packages/:packageId/images", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const pkg = await prisma.package.findUnique({ where: { id: Number(req.params.packageId) }, include: { images: true } });
  if (!pkg || pkg.vendorId !== vendor.id) return res.status(404).json({ error: "Package not found" });

  const image = await prisma.packageImage.create({
    data: { packageId: pkg.id, imageUrl, position: pkg.images.length },
  });
  res.status(201).json(image);
});

// DELETE /api/vendors/me/packages/:packageId/images/:imageId
router.delete("/me/packages/:packageId/images/:imageId", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const pkg = await prisma.package.findUnique({ where: { id: Number(req.params.packageId) } });
  if (!pkg || pkg.vendorId !== vendor.id) return res.status(404).json({ error: "Package not found" });

  const image = await prisma.packageImage.findUnique({ where: { id: Number(req.params.imageId) } });
  if (!image || image.packageId !== pkg.id) return res.status(404).json({ error: "Image not found" });

  await prisma.packageImage.delete({ where: { id: image.id } });
  res.status(204).send();
});

module.exports = router;
