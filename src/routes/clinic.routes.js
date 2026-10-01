const express = require("express");

const authenticate = require("../middleware/auth.middleware");

const {
  getPendingPrescriptions,
  getPrescriptionDetails,
  dispenseMedicine,
  completeDispensing,
  getPrescriptionReceipt,
} = require("../controllers/clinic.controller");

const router = express.Router();

// Authentication
router.use(authenticate);

// 1. Pending prescriptions
router.get("/prescriptions/pending", getPendingPrescriptions);

// 2. Prescription details
router.get("/prescriptions/:prescriptionId", getPrescriptionDetails);

// 3. Give / unavailable
router.post("/dispensing/:itemId", dispenseMedicine);

// 4. Complete dispensing
router.post("/dispensing/:prescriptionId/complete", completeDispensing);

// 5. Prescription receipt
router.get("/prescriptions/:prescriptionId/receipt", getPrescriptionReceipt);

module.exports = router;
