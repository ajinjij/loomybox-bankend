const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notify } = require("../lib/notifications");

const router = express.Router();
router.use(requireAuth);

// Resolves the current user to { customerId, vendorId } shape needed to find/create
// a conversation, whichever side (customer or vendor) they're on.
async function resolveParticipant(req, otherPartyId) {
  if (req.user.role === "CUSTOMER") {
    return { customerId: req.user.id, vendorId: Number(otherPartyId) };
  }
  if (req.user.role === "VENDOR") {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
    return { customerId: Number(otherPartyId), vendorId: vendor.id };
  }
  return null;
}

// GET /api/messages/conversations — every conversation the logged-in user is part of.
router.get("/conversations", requireRole("CUSTOMER", "VENDOR"), async (req, res) => {
  let where;
  if (req.user.role === "CUSTOMER") {
    where = { customerId: req.user.id };
  } else {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
    where = { vendorId: vendor.id };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      vendor: { select: { id: true, businessName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { id: "desc" },
  });
  res.json(conversations);
});

// GET /api/messages/conversations/:id — full message history for one conversation.
router.get("/conversations/:id", requireRole("CUSTOMER", "VENDOR"), async (req, res) => {
  const convo = await prisma.conversation.findUnique({
    where: { id: Number(req.params.id) },
    include: { messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, name: true } } } } },
  });
  if (!convo) return res.status(404).json({ error: "Conversation not found" });

  const vendor = req.user.role === "VENDOR" ? await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } }) : null;
  const owns = convo.customerId === req.user.id || (vendor && convo.vendorId === vendor.id);
  if (!owns) return res.status(403).json({ error: "You do not have access to this conversation" });

  // Mark the other party's messages as read now that this user opened the thread.
  await prisma.message.updateMany({
    where: { conversationId: convo.id, senderId: { not: req.user.id }, read: false },
    data: { read: true },
  });

  res.json(convo);
});

// POST /api/messages/to/:otherPartyId
// Customer: otherPartyId is a vendorId. Vendor: otherPartyId is a customer's userId.
// Body: { content }. Creates the conversation on first message.
router.post("/to/:otherPartyId", requireRole("CUSTOMER", "VENDOR"), async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "content is required" });

  const participant = await resolveParticipant(req, req.params.otherPartyId);
  if (!participant) return res.status(400).json({ error: "Invalid conversation participant" });

  const conversation = await prisma.conversation.upsert({
    where: { customerId_vendorId: participant },
    update: {},
    create: participant,
  });

  const message = await prisma.message.create({
    data: { conversationId: conversation.id, senderId: req.user.id, content: content.trim() },
    include: { sender: { select: { id: true, name: true } } },
  });

  // Notify the other party.
  if (req.user.role === "CUSTOMER") {
    const vendor = await prisma.vendorProfile.findUnique({ where: { id: participant.vendorId } });
    if (vendor) await notify(vendor.userId, "MESSAGE_RECEIVED", `New message from a customer`, "vendor-dashboard.html");
  } else {
    await notify(participant.customerId, "MESSAGE_RECEIVED", `New message from a vendor`, "bookings.html");
  }

  res.status(201).json(message);
});

module.exports = router;
