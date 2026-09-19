const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// POST /api/reviews
// Customer: leave a review on a completed booking. Recomputes the vendor's
// average rating so their profile and listing cards stay up to date.
router.post("/", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const { bookingId, rating, comment } = req.body;
  if (!bookingId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "bookingId and a rating from 1 to 5 are required" });
  }

  const booking = await prisma.booking.findUnique({ where: { id: Number(bookingId) } });
  if (!booking || booking.customerId !== req.user.id) {
    return res.status(404).json({ error: "Booking not found" });
  }
  if (booking.status !== "COMPLETED") {
    return res.status(400).json({ error: "You can only review a completed booking" });
  }

  const existing = await prisma.review.findUnique({ where: { bookingId: booking.id } });
  if (existing) {
    return res.status(409).json({ error: "You have already reviewed this booking" });
  }

  const review = await prisma.review.create({
    data: { bookingId: booking.id, customerId: req.user.id, rating: Number(rating), comment },
  });

  // Recompute the vendor's running average rating.
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: booking.vendorId } });
  const newCount = vendor.reviewCount + 1;
  const newRating = Number((((vendor.rating * vendor.reviewCount) + Number(rating)) / newCount).toFixed(2));
  await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { rating: newRating, reviewCount: newCount },
  });

  res.status(201).json(review);
});

// GET /api/reviews/vendor/:vendorId
// Public: list reviews for a vendor's profile page.
router.get("/vendor/:vendorId", async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { booking: { vendorId: Number(req.params.vendorId) } },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(reviews);
});

// GET /api/reviews/vendor/:vendorId/summary
// Public: an AI-generated 2-3 sentence summary of this vendor's reviews, so a
// customer doesn't have to read all of them. Built only from real review text
// on file — returns null if there aren't enough reviews yet to summarize.
router.get("/vendor/:vendorId/summary", async (req, res) => {
  const reviews = await prisma.review.findMany({
    where: { booking: { vendorId: Number(req.params.vendorId) }, comment: { not: null } },
    select: { rating: true, comment: true },
    orderBy: { createdAt: "desc" },
    take: 30, // cap what we send to the model
  });

  if (reviews.length < 3) {
    return res.json({ summary: null, reviewCount: reviews.length });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ summary: null, reviewCount: reviews.length, error: "AI summary unavailable (server not configured)" });
  }

  const reviewText = reviews.map((r) => `[${r.rating}★] ${r.comment}`).join("\n");
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Summarize these customer reviews for an event vendor in 2-3 sentences. Mention recurring positives and, if present, recurring concerns. Be neutral and factual, base it only on what's written below, don't invent details. Reviews:\n\n${reviewText}`,
        }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
    const data = await response.json();
    const summary = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    res.json({ summary, reviewCount: reviews.length });
  } catch (err) {
    console.error("Review summary generation failed:", err.message);
    res.json({ summary: null, reviewCount: reviews.length, error: "AI summary unavailable right now" });
  }
});

module.exports = router;
