const express = require("express");

const authenticate = require("../middleware/auth.middleware");

const {
  // =========================
  // DASHBOARD
  // =========================
  getDashboard,

  //profile

  getPatientProfile,
  updatePatientProfile,

  // =========================
  // SEARCH
  // =========================
  searchDiseaseSpecialization,

  // =========================
  // OPD
  // =========================
  getOpdOptions,

  // =========================
  // TOKENS
  // =========================
  bookToken,
  getMyTodayToken,
  getMyPrescriptions,
  getMyPrescriptionDetails,
  // =========================
  // NOTIFICATIONS
  // =========================
  getNotifications,
  markNotificationRead,
} = require("../controllers/patient.controller");

const router = express.Router();

// ======================================================
// AUTHENTICATION
// All patient APIs require JWT
// ======================================================

router.use(authenticate);

// ======================================================
// DASHBOARD
// GET /api/patient/dashboard
// ======================================================

router.get("/dashboard", getDashboard);

router.get("/profile", getPatientProfile);

router.put("/profile", updatePatientProfile);

// ======================================================
// SEARCH
// GET /api/patient/search
// ======================================================

router.get("/search", searchDiseaseSpecialization);

// ======================================================
// OPD OPTIONS
// GET /api/patient/opd-options
// ======================================================

router.get("/opd-options", getOpdOptions);

// ======================================================
// BOOK TOKEN
// POST /api/patient/tokens
// ======================================================

router.post("/tokens", bookToken);

// ======================================================
// MY TODAY TOKEN
// GET /api/patient/my-token/today
// ======================================================

router.get("/my-token/today", getMyTodayToken);

// ======================================================
// PRESCRIPTIONS
// ======================================================

router.get("/prescriptions", getMyPrescriptions);

router.get("/prescriptions/:prescriptionId", getMyPrescriptionDetails);

// ======================================================
// NOTIFICATIONS
// GET /api/patient/notifications
// ======================================================

router.get("/notifications", getNotifications);

// ======================================================
// MARK NOTIFICATION READ
// PUT /api/patient/notifications/:id/read
// ======================================================

router.put("/notifications/:id/read", markNotificationRead);

module.exports = router;
