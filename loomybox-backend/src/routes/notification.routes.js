const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications — the logged-in user's notifications, newest first.
router.get("/", async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

// GET /api/notifications/unread-count — powers the bell badge without pulling the full list.
router.get("/unread-count", async (req, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user.id, read: false } });
  res.json({ count });
});

// POST /api/notifications/:id/read
router.post("/:id/read", async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: Number(req.params.id) } });
  if (!notification || notification.userId !== req.user.id) {
    return res.status(404).json({ error: "Notification not found" });
  }
  const updated = await prisma.notification.update({ where: { id: notification.id }, data: { read: true } });
  res.json(updated);
});

// POST /api/notifications/read-all
router.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
  res.json({ ok: true });
});

module.exports = router;
