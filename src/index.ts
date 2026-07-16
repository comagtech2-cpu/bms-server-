import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import authRoutes from "./routes/auth";
import dashboardRoutes from "./routes/dashboard";
import productRoutes from "./routes/products";
import categoryRoutes from "./routes/categories";
import customerRoutes from "./routes/customers";
import transactionRoutes from "./routes/transactions";
import inventoryRoutes from "./routes/inventory";
import reportRoutes from "./routes/reports";
import settingsRoutes from "./routes/settings";
import auditRoutes from "./routes/audit";
import notificationRoutes from "./routes/notifications";
import adminRoutes from "./routes/admin";

import { connectDB } from "./lib/db";
import { auditLog } from "./middleware/audit";

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173", //local client
  "http://localhost:3000",
  "https://bms-server-hu2d.onrender.com", //server
  "https://bms-client-xdo3.onrender.com", //new client
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes(origin.replace(/\/$/, "")) ||
      origin.startsWith("http://localhost:") ||
      origin.endsWith(".onrender.com") ||
      origin.includes("onrender.com") ||
      origin.includes("vercel.app") ||
      origin.includes("netlify.app")
    ) {
      callback(null, true);
    } else {
      console.warn(`[CORS Warning] Origin check fallback for: ${origin}`);
      callback(null, true); // Allow gracefully instead of throwing 500 error on OPTIONS/preflight
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Audit ────────────────────────────────────────────────────────────────────
app.use("/api/v1", auditLog());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/audit-logs", auditRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

// ─── Serve Admin Panel (static HTML/CSS/JS) ──────────────────────────────────
app.use("/admin", express.static(path.join(__dirname, "..", "admin")));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() }),
);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ message: "Internal server error" });
  },
);

app.listen(PORT, () => {
  console.log(`\n🚀 BMS Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health\n`);
});

export default app;
