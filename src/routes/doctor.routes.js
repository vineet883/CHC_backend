const express = require("express");

const authenticate = require("../middleware/auth.middleware");

const {
  getToday,
  getPatients,
  callNext,
  holdPatient,
  skipPatient,
  recallPatient,
  getCurrentPatient,
  createPrescription,
  completeConsultation,
  getMedicines,
} = require("../controllers/doctor.controller");

const router = express.Router();

// All doctor APIs require authentication
router.use(authenticate);

// 1. Today's OPD
router.get("/today", getToday);

// 2. Patient queue
router.get("/patients", getPatients);

// 3. Call next patient
router.post("/call-next", callNext);
router.get("/medicines", getMedicines);
// 4. Hold
router.post("/hold/:tokenId", holdPatient);

// 5. Skip
router.post("/skip/:tokenId", skipPatient);

// 6. Recall
router.post("/recall/:tokenId", recallPatient);

// 7. Current patient
router.get("/current-patient", getCurrentPatient);

// 8. Prescription
router.post("/prescriptions", createPrescription);

// 9. Complete consultation
router.post("/complete-consultation", completeConsultation);

module.exports = router;
