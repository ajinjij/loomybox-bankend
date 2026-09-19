// Creates a default admin account so you have someone who can approve
// vendors and manage disputes right after setup.
// Run with: npm run seed

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = "admin@loomybox.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin account already exists:", email);
    return;
  }

  const password = await bcrypt.hash("admin123", 10);
  await prisma.user.create({
    data: { name: "Platform Admin", email, password, role: "ADMIN" },
  });

  // Default site settings, editable later from the admin dashboard.
  // homeSections is a JSON-encoded array powering the "Homepage Sections" builder
  // in the admin dashboard — admins can add/reorder/remove blocks with no code changes.
  const defaultSettings = {
    siteName: "Loomybox",
    accentColor: "#E8607C",
    heroHeadline: "Plan the day. Skip the guesswork.",
    heroSubtext: "Compare verified event coordinators and book securely — payment held in escrow until your event is delivered.",
    homeSections: JSON.stringify([
      {
        id: "s1",
        type: "banner",
        placement: "bottom",
        enabled: true,
        title: "Why plan with Loomybox?",
        body: "Every vendor is verified, every payment is held in escrow until your event is delivered, and every booking is backed by our dispute support team.",
        imageUrl: "",
        buttonText: "Browse packages",
        buttonLink: "index.html",
      },
    ]),
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // A sample coupon so there's something to test with right away.
  const existingCoupon = await prisma.coupon.findUnique({ where: { code: "WELCOME10" } });
  if (!existingCoupon) {
    await prisma.coupon.create({
      data: { code: "WELCOME10", type: "PERCENT", value: 10, minOrder: 1000 },
    });
  }

  console.log("Admin account created:");
  console.log("  email:    admin@loomybox.com");
  console.log("  password: admin123");
  console.log("Change this password before deploying anywhere real.");
  console.log("Sample coupon created: WELCOME10 (10% off, min order ₹1,000)");
  console.log("Default site settings created (siteName, accent color, hero copy, a starter homepage section).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
