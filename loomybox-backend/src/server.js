require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const vendorRoutes = require("./routes/vendor.routes");
const requirementRoutes = require("./routes/requirement.routes");
const quoteRoutes = require("./routes/quote.routes");
const bookingRoutes = require("./routes/booking.routes");
const paymentRoutes = require("./routes/payment.routes");
const reviewRoutes = require("./routes/review.routes");
const adminRoutes = require("./routes/admin.routes");
const cartRoutes = require("./routes/cart.routes");
const packageRoutes = require("./routes/package.routes");
const wishlistRoutes = require("./routes/wishlist.routes");
const settingsRoutes = require("./routes/settings.routes");
const assistantRoutes = require("./routes/assistant.routes");
const notificationRoutes = require("./routes/notification.routes");
const messageRoutes = require("./routes/message.routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/requirements", requirementRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/messages", messageRoutes);

// Fallback error handler so unexpected failures return JSON, not an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Loomybox.com API running on http://localhost:${PORT}`);
});
