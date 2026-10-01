const express = require("express");

const authenticate = require("../middleware/auth.middleware");

const router = express.Router();

const {
  // ======================================================
  // PATIENT
  // ======================================================

  getPatientCertificateProfile,
  getCertificateDepartments,
  getCertificateDoctors,
  createMedicalCertificateRequest,
  getMyMedicalCertificates,
  getMedicalCertificateDetails,
  downloadMedicalCertificate,

  // ======================================================
  // DOCTOR
  // ======================================================

  getDoctorCertificates,
  getDoctorCertificateDetails,
  submitDoctorCertificate,

  // ======================================================
  // MEDICAL OFFICER / ADMIN
  // ======================================================
  getMedicalOfficerCertificates,
  getMedicalOfficerCertificateDetails,
  approveMedicalCertificate,
  returnMedicalCertificate,
  rejectMedicalCertificate,
} = require("../controllers/certificate.controller");

// ======================================================
// AUTHENTICATION
// ======================================================

router.use(authenticate);

// ======================================================
// PATIENT PROFILE
// GET /certificates/profile
// ======================================================

router.get("/profile", getPatientCertificateProfile);

// ======================================================
// DEPARTMENTS
// GET /certificates/departments
// ======================================================

router.get("/departments", getCertificateDepartments);

// ======================================================
// DOCTORS BY DEPARTMENT
// GET /certificates/doctors?departmentId=1
// ======================================================

router.get("/doctors", getCertificateDoctors);

// ======================================================
// CREATE MEDICAL CERTIFICATE REQUEST
// POST /certificates
// ======================================================

router.post("/", createMedicalCertificateRequest);

// ======================================================
// PATIENT: MY CERTIFICATES
// GET /certificates
// ======================================================

router.get("/", getMyMedicalCertificates);

// ======================================================
// ======================================================
// DOCTOR ROUTES
// ======================================================
// IMPORTANT:
// These MUST come before /:id routes.
// ======================================================

// ======================================================
// DOCTOR: GET ALL ASSIGNED CERTIFICATE REQUESTS
// GET /certificates/doctor
// ======================================================

router.get("/doctor", getDoctorCertificates);

// ======================================================
// DOCTOR: GET CERTIFICATE REQUEST DETAILS
// GET /certificates/doctor/:id
// ======================================================

router.get("/doctor/:id", getDoctorCertificateDetails);

// ======================================================
// DOCTOR: SUBMIT CERTIFICATE FOR MEDICAL OFFICER
// APPROVAL
//
// POST /certificates/doctor/:id/submit
// ======================================================

router.post("/doctor/:id/submit", submitDoctorCertificate);



// ======================================================
// MEDICAL OFFICER / ADMIN
// ======================================================

router.get(
  "/medical-officer",
  getMedicalOfficerCertificates,
);

router.get(
  "/medical-officer/:id",
  getMedicalOfficerCertificateDetails,
);

router.post(
  "/medical-officer/:id/approve",
  approveMedicalCertificate,
);

router.post(
  "/medical-officer/:id/return",
  returnMedicalCertificate,
);

router.post(
  "/medical-officer/:id/reject",
  rejectMedicalCertificate,
);
// ======================================================
// PATIENT: DOWNLOAD APPROVED CERTIFICATE
// GET /certificates/:id/download
// ======================================================

router.get("/:id/download", downloadMedicalCertificate);
// ======================================================
// PATIENT: GET CERTIFICATE DETAILS
// GET /certificates/:id
// ======================================================

router.get("/:id", getMedicalCertificateDetails);



// ======================================================
// EXPORT
// ======================================================

module.exports = router;
