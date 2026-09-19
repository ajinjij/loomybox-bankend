const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("CUSTOMER"));

// GET /api/wishlist
router.get("/", async (req, res) => {
  const items = await prisma.wishlistItem.findMany({
    where: { customerId: req.user.id },
    include: { package: { include: { vendor: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

// POST /api/wishlist
// Body: { packageId }
router.post("/", async (req, res) => {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ error: "packageId is required" });

  const existing = await prisma.wishlistItem.findUnique({
    where: { customerId_packageId: { customerId: req.user.id, packageId: Number(packageId) } },
  });
  if (existing) return res.status(409).json({ error: "Already in your wishlist" });

  const item = await prisma.wishlistItem.create({
    data: { customerId: req.user.id, packageId: Number(packageId) },
    include: { package: { include: { vendor: true } } },
  });
  res.status(201).json(item);
});

// DELETE /api/wishlist/:packageId
router.delete("/:packageId", async (req, res) => {
  const existing = await prisma.wishlistItem.findUnique({
    where: { customerId_packageId: { customerId: req.user.id, packageId: Number(req.params.packageId) } },
  });
  if (!existing) return res.status(404).json({ error: "Not in your wishlist" });

  await prisma.wishlistItem.delete({ where: { id: existing.id } });
  res.status(204).send();
});

module.exports = router;
