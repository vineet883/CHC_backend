const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const authRoutes = require("./src/routes/auth.routes");
const patientRoutes = require("./src/routes/patient.routes");
const adminRoutes = require("./src/routes/admin.routes");
const doctorRoutes = require("./src/routes/doctor.routes");
const clinicRoutes = require("./src/routes/clinic.routes");
const certificateRoutes = require("./src/routes/certificate.routes");

const app = express();

// ======================================================
// CORS
// ======================================================

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://chc-frontend-uipe.vercel.app",
    ];

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));

// ======================================================
// GLOBAL MIDDLEWARE
// ======================================================

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Yo Doctor API is running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    service: "YoDoctor API",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ======================================================
// API ROUTES
// ======================================================

app.use("/auth", authRoutes);

app.use("/certificates", certificateRoutes);

app.use("/patient", patientRoutes);

app.use("/doctor", doctorRoutes);

app.use("/clinic", clinicRoutes);

app.use("/admin", adminRoutes);

// ======================================================
// 404 HANDLER
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  console.error("[ERROR]", err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

module.exports = app;
