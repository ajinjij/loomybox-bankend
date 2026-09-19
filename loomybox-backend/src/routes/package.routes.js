const express = require("express");
const prisma = require("../lib/prisma");
const { fuzzyIncludes } = require("../lib/fuzzy");

const router = express.Router();

// GET /api/packages?search=wedding&category=wedding&city=Mumbai&district=Ernakulam&pincode=682001&minPrice=&maxPrice=&minRating=&sort=price_asc|price_desc|rating|newest
// Public: the main search endpoint the homepage search bar and browse/filter page use.
// Only returns packages from approved vendors.
router.get("/", async (req, res) => {
  const { search, category, city, district, pincode, minPrice, maxPrice, minRating, sort, availableOn } = req.query;

  const orderBy =
    sort === "price_asc" ? { price: "asc" } :
    sort === "price_desc" ? { price: "desc" } :
    sort === "rating" ? { vendor: { rating: "desc" } } :
    { createdAt: "desc" }; // "newest" / default

  // If the customer picked an event date, exclude vendors who've blocked that
  // exact day on their calendar — no point showing a package they can't
  // actually deliver on that date.
  let availabilityWhere = {};
  if (availableOn) {
    const day = new Date(availableOn);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    availabilityWhere = { blockedDates: { none: { date: { gte: dayStart, lt: dayEnd } } } };
  }

  const baseWhere = {
    vendor: {
      status: "APPROVED",
      ...(category ? { category: String(category) } : {}),
      ...(city ? { city: { contains: String(city) } } : {}),
      ...(district ? { district: String(district) } : {}),
      ...(pincode ? { pincode: { startsWith: String(pincode) } } : {}),
      ...(minRating ? { rating: { gte: Number(minRating) } } : {}),
      ...availabilityWhere,
    },
    ...(minPrice ? { price: { gte: Number(minPrice) } } : {}),
    ...(maxPrice ? { price: { lte: Number(maxPrice) } } : {}),
  };

  // First try an exact substring match (fast, uses the DB index).
  let packages = await prisma.package.findMany({
    where: {
      ...baseWhere,
      ...(search
        ? { OR: [{ name: { contains: String(search) } }, { description: { contains: String(search) } }] }
        : {}),
    },
    include: { vendor: true, images: true },
    orderBy,
  });

  // If a search term was given but came back empty (or thin), broaden to a
  // typo-tolerant pass over name/description/category/business name so a
  // misspelled query like "phtography" still finds "Photography".
  if (search && packages.length === 0) {
    const candidates = await prisma.package.findMany({ where: baseWhere, include: { vendor: true, images: true }, orderBy });
    packages = candidates.filter((pkg) =>
      fuzzyIncludes(pkg.name, String(search)) ||
      fuzzyIncludes(pkg.description || "", String(search)) ||
      fuzzyIncludes(pkg.vendor.category, String(search)) ||
      fuzzyIncludes(pkg.vendor.businessName, String(search))
    );
  }

  res.json(packages);
});

// GET /api/packages/:id
// Public: a single package's details, for a product-detail-style view.
router.get("/:id", async (req, res) => {
  const pkg = await prisma.package.findUnique({
    where: { id: Number(req.params.id) },
    include: { vendor: true, images: { orderBy: { position: "asc" } } },
  });
  if (!pkg || pkg.vendor.status !== "APPROVED") {
    return res.status(404).json({ error: "Package not found" });
  }
  res.json(pkg);
});

// GET /api/packages/:id/suggestions
// Public: "you might also like" — other packages in the same category (preferring
// the same city), excluding this one. Used on the product detail page.
router.get("/:id/suggestions", async (req, res) => {
  const pkg = await prisma.package.findUnique({
    where: { id: Number(req.params.id) },
    include: { vendor: true },
  });
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  // Prefer same category + same city first, then same category anywhere,
  // then just fill remaining slots with other approved packages.
  const sameCategorySameCity = await prisma.package.findMany({
    where: {
      id: { not: pkg.id },
      vendor: { status: "APPROVED", category: pkg.vendor.category, city: pkg.vendor.city },
    },
    include: { vendor: true },
    take: 4,
  });

  let suggestions = sameCategorySameCity;
  if (suggestions.length < 4) {
    const more = await prisma.package.findMany({
      where: {
        id: { not: pkg.id, notIn: suggestions.map((s) => s.id) },
        vendor: { status: "APPROVED", category: pkg.vendor.category },
      },
      include: { vendor: true },
      take: 4 - suggestions.length,
    });
    suggestions = suggestions.concat(more);
  }
  if (suggestions.length < 4) {
    const more = await prisma.package.findMany({
      where: { id: { not: pkg.id, notIn: suggestions.map((s) => s.id) }, vendor: { status: "APPROVED" } },
      include: { vendor: true },
      orderBy: { createdAt: "desc" },
      take: 4 - suggestions.length,
    });
    suggestions = suggestions.concat(more);
  }

  res.json(suggestions);
});

// GET /api/packages/:id/recommendations
// Public: "frequently booked together" — other packages that customers who
// booked this one also booked, ranked by co-occurrence count. Falls back to
// an empty list gracefully until there's enough booking history to be useful.
router.get("/:id/recommendations", async (req, res) => {
  const packageId = Number(req.params.id);

  // Every customer who has ever booked this package.
  const bookingsOfThis = await prisma.booking.findMany({
    where: { packageId, status: { not: "CANCELLED" } },
    select: { customerId: true },
  });
  const customerIds = [...new Set(bookingsOfThis.map((b) => b.customerId))];
  if (customerIds.length === 0) return res.json([]);

  // Every OTHER package those same customers have booked.
  const otherBookings = await prisma.booking.findMany({
    where: {
      customerId: { in: customerIds },
      packageId: { not: packageId },
      AND: [{ packageId: { not: null } }],
      status: { not: "CANCELLED" },
    },
    select: { packageId: true },
  });

  const counts = {};
  for (const b of otherBookings) {
    if (b.packageId == null) continue;
    counts[b.packageId] = (counts[b.packageId] || 0) + 1;
  }
  const topIds = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => Number(id));

  if (topIds.length === 0) return res.json([]);

  const packages = await prisma.package.findMany({
    where: { id: { in: topIds }, vendor: { status: "APPROVED" } },
    include: { vendor: true, images: true },
  });
  // Preserve the co-occurrence ranking (Prisma's `in` doesn't guarantee order).
  packages.sort((a, b) => counts[b.id] - counts[a.id]);
  res.json(packages);
});

module.exports = router;
