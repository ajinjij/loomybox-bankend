const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// POST /api/requirements
// Customer: post a new event requirement. This is what vendors send quotes against.
router.post("/", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const { eventType, eventDate, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes } = req.body;

  if (!eventType || !eventDate || !city) {
    return res.status(400).json({ error: "eventType, eventDate and city are required" });
  }

  const requirement = await prisma.requirement.create({
    data: {
      customerId: req.user.id,
      eventType,
      eventDate: new Date(eventDate),
      city,
      guestCount: guestCount ? Number(guestCount) : null,
      budgetMin: budgetMin ? Number(budgetMin) : null,
      budgetMax: budgetMax ? Number(budgetMax) : null,
      servicesNeeded,
      notes,
    },
  });
  res.status(201).json(requirement);
});

// GET /api/requirements/mine
// Customer: see their own posted requirements and how many quotes each has.
router.get("/mine", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const requirements = await prisma.requirement.findMany({
    where: { customerId: req.user.id },
    include: { quotes: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(requirements);
});

// GET /api/requirements/open
// Vendor: see open requirements that match their category and city, so they can quote.
router.get("/open", requireAuth, requireRole("VENDOR"), async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });

  const requirements = await prisma.requirement.findMany({
    where: {
      status: "OPEN",
      ...(vendor.city ? { city: vendor.city } : {}),
      ...(vendor.category && vendor.category !== "other" ? { eventType: vendor.category } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(requirements);
});

// GET /api/requirements/:id
// Owner (customer) or any vendor can view a single requirement's details.
router.get("/:id", requireAuth, async (req, res) => {
  const requirement = await prisma.requirement.findUnique({
    where: { id: Number(req.params.id) },
    include: { quotes: { include: { vendor: true } } },
  });
  if (!requirement) return res.status(404).json({ error: "Requirement not found" });

  if (req.user.role === "CUSTOMER" && requirement.customerId !== req.user.id) {
    return res.status(403).json({ error: "You can only view your own requirements" });
  }
  res.json(requirement);
});

module.exports = router;
