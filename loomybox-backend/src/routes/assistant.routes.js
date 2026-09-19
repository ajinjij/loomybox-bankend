const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// Known service categories — MUST stay in sync with CATEGORIES in frontend/assets/api.js
const KNOWN_CATEGORIES = [
  "event", "birthday", "transportation", "corporate", "local-event",
  "photography", "gift-hampers", "surprise-gift",
];

// Calls the Anthropic API and asks for a strict-JSON event plan. Kept in its
// own function so the route handler stays readable and errors are easy to
// catch and turn into a clean 502 instead of a raw stack trace.
async function generateEventPlan({ eventType, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set on the server");
  }

  const prompt = `You are an event-planning assistant for Loomybox.com, an Indian event-vendor marketplace.
A customer gave these details:
- Event type: ${eventType}
- City: ${city || "not specified"}
- Guest count: ${guestCount || "not specified"}
- Budget: ${budgetMin || "?"} to ${budgetMax || "?"} (INR)
- Services they already mentioned: ${servicesNeeded || "none specified"}
- Notes: ${notes || "none"}

Respond with ONLY a JSON object (no markdown fences, no commentary) with this exact shape:
{
  "checklist": [
    { "category": "<one of: ${KNOWN_CATEGORIES.join(", ")}>", "why": "<one short sentence>", "suggestedBudgetShare": <number 0-100, all categories should roughly sum to 100> }
  ],
  "advice": "<2-3 sentences of practical planning advice specific to this event type, budget and guest count>"
}
Only include categories that are actually relevant to this event. Keep "why" under 15 words.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      // Check https://docs.claude.com for the current recommended model string
      // before deploying — pin it via ANTHROPIC_MODEL so upgrading is a
      // one-line env change instead of a code change.
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed;
  try {
    // Strip stray ```json fences in case the model adds them despite instructions.
    const cleaned = text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Could not parse the assistant's response as JSON");
  }

  if (!Array.isArray(parsed.checklist)) parsed.checklist = [];
  return parsed;
}

// POST /api/assistant/plan
// Public. Body: { eventType, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes }
// Returns an AI-generated checklist + budget split, plus real matching packages
// per category (so the customer sees actual bookable options alongside the
// advice), and flags which categories have no good match yet — those are the
// ones worth posting as a custom Requirement for vendor quotes.
router.post("/plan", async (req, res) => {
  const { eventType, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes } = req.body;

  if (!eventType) {
    return res.status(400).json({ error: "eventType is required" });
  }

  let plan;
  try {
    plan = await generateEventPlan({ eventType, city, guestCount, budgetMin, budgetMax, servicesNeeded, notes });
  } catch (err) {
    console.error("Assistant plan generation failed:", err.message);
    return res.status(502).json({ error: "The planning assistant is unavailable right now. Please try again shortly." });
  }

  // For each suggested category, look for real matching packages (approved
  // vendors only) so the customer sees bookable options next to the advice.
  const categoriesWithMatches = await Promise.all(
    plan.checklist.map(async (item) => {
      const category = KNOWN_CATEGORIES.includes(item.category) ? item.category : null;
      let matches = [];
      if (category) {
        matches = await prisma.package.findMany({
          where: {
            vendor: {
              status: "APPROVED",
              category,
              ...(city ? { city: { contains: String(city) } } : {}),
            },
            ...(budgetMax ? { price: { lte: Number(budgetMax) } } : {}),
          },
          include: { vendor: true },
          orderBy: { vendor: { rating: "desc" } },
          take: 3,
        });
      }
      return { ...item, matches, hasMatches: matches.length > 0 };
    })
  );

  res.json({
    advice: plan.advice || "",
    checklist: categoriesWithMatches,
    // Categories the customer should consider posting as a custom requirement
    // for vendor quotes, since no ready-made package fit was found.
    needsCustomQuote: categoriesWithMatches.filter((c) => !c.hasMatches).map((c) => c.category),
  });
});

// POST /api/assistant/support
// Public. Body: { message, history? }. A lightweight support chatbot that
// answers common questions about how Loomybox works (escrow, refunds,
// booking flow) from a fixed policy brief — it does NOT have access to any
// individual customer's private booking data, so it never invents specifics
// about "your" booking; it points those questions to My Orders / My requirements instead.
router.post("/support", async (req, res) => {
  const { message, history } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(502).json({ error: "Support chat is unavailable right now." });
  }

  const systemPrompt = `You are the Loomybox.com support assistant. Loomybox is an event-vendor marketplace connecting customers with vendors (photography, catering, decor, venues, etc.).
How the platform works:
- Customers browse ready-made packages and buy directly (cart → checkout), or post a "requirement" describing their event and get custom quotes from vendors, then accept one.
- Payment is held in escrow: marked HELD when paid, RELEASED to the vendor after the vendor marks the booking COMPLETED (or by admin resolving a dispute), or REFUNDED if a dispute resolves in the customer's favor.
- Bookings can be paid FULL upfront or SPLIT (50% now, 50% before the event).
- If something goes wrong, either party can file a dispute on the booking, which pauses the escrow release until admin reviews it.
- Vendors must be approved by an admin before they can list packages or send quotes.
Answer briefly and helpfully. If asked about a SPECIFIC booking/order/refund status, you don't have access to individual records — tell them to check "My Orders" (customer) or the vendor dashboard, and that they can also file a dispute from a booking if something's wrong. Never invent order details, dates, or amounts.`;

  const messages = [
    ...(Array.isArray(history) ? history.slice(-6).map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content).slice(0, 1000) })) : []),
    { role: "user", content: message.trim().slice(0, 1000) },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    });
    if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
    const data = await response.json();
    const reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json({ reply });
  } catch (err) {
    console.error("Support chat failed:", err.message);
    res.status(502).json({ error: "Support chat is unavailable right now — please try again shortly." });
  }
});

module.exports = router;
