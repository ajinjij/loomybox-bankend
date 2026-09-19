const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// GET /api/settings
// Public: returns all site settings as a flat object, e.g. { accentColor: "#E8607C", heroHeadline: "..." }.
// The frontend fetches this once on page load to theme itself and show admin-edited copy.
router.get("/", async (req, res) => {
  const rows = await prisma.setting.findMany();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

module.exports = router;
