require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

require("./db"); // ensures schema + seed data exist before routes touch it

const categoriesRouter = require("./routes/categories");
const { router: vendorsRouter } = require("./routes/vendors");
const bookingsRouter = require("./routes/bookings");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/categories", categoriesRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/bookings", bookingsRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

app.listen(PORT, () => {
  console.log(`Loomybox API listening on http://localhost:${PORT}`);
});
