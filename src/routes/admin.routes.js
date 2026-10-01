const express = require("express");

const authenticate = require("../middleware/auth.middleware");

const {
  // =========================
  // DOCTORS
  // =========================
  addDoctor,
  getDoctors,
  updateDoctor,
  deleteDoctor,

  // =========================
  // ROOMS
  // =========================
  addRoom,
  getRooms,
  updateRoom,
  deleteRoom,

  // =========================
  // DOCTOR ROOM ASSIGNMENTS
  // =========================
  assignDoctorToRoom,
  getDoctorRoomAssignments,
  updateDoctorRoomAssignment,

  // =========================
  // DASHBOARD
  // =========================
  getDashboard,
  getPatientStats,
  getMedicineStats,
  getRoomStats,
  getDoctorStats,

  // =========================
  // MEDICINES / INVENTORY
  // =========================
  getMedicines,
  addMedicine,
  updateMedicine,
  deleteMedicine,
  getInventory,
  getInventoryTransactions,

  // =========================
  // PRESCRIPTION / DISPENSING
  // =========================
  getPrescriptions,


  // =========================
  // PRESCRIPTION CANCELLATION
  // =========================
  cancelPrescription,
  getCancelledPrescriptions,

  // =========================
  // DAY END
  // =========================
  closeDay,
  getReports,
  getReportById,

  // =========================
  // OPD
  // =========================
  startOpd,
  endOpd,
  getTodayOpd,
} = require("../controllers/admin.controller");

const router = express.Router();

router.use(authenticate);

// ======================================================
// DOCTORS
// ======================================================

router.post("/doctors", addDoctor);
router.get("/doctors", getDoctors);
router.put("/doctors/:id", updateDoctor);
router.delete("/doctors/:id", deleteDoctor);

// ======================================================
// ROOMS
// ======================================================

router.post("/rooms", addRoom);
router.get("/rooms", getRooms);
router.put("/rooms/:id", updateRoom);
router.delete("/rooms/:id", deleteRoom);

// ======================================================
// DOCTOR ROOM ASSIGNMENTS
// ======================================================

router.post(
  "/doctor-room-assignments",
  assignDoctorToRoom
);

router.get(
  "/doctor-room-assignments",
  getDoctorRoomAssignments
);

router.put(
  "/doctor-room-assignments/:id",
  updateDoctorRoomAssignment
);

// ======================================================
// DASHBOARD
// ======================================================

router.get("/dashboard", getDashboard);

router.get(
  "/dashboard/patients",
  getPatientStats
);

router.get(
  "/dashboard/medicines",
  getMedicineStats
);

router.get(
  "/dashboard/rooms",
  getRoomStats
);

router.get(
  "/dashboard/doctors",
  getDoctorStats
);

// ======================================================
// MEDICINES
// ======================================================

router.get("/medicines", getMedicines);
router.post("/medicines", addMedicine);
router.put("/medicines/:id", updateMedicine);
router.delete("/medicines/:id", deleteMedicine);

// ======================================================
// INVENTORY
// ======================================================

router.get("/inventory", getInventory);

router.get(
  "/inventory/transactions",
  getInventoryTransactions
);

// ======================================================
// PRESCRIPTIONS
// ======================================================

router.get(
  "/prescriptions",
  getPrescriptions
);



// ======================================================
// PRESCRIPTION CANCELLATION
// ======================================================

router.post(
  "/prescriptions/:id/cancel",
  cancelPrescription
);

router.get(
  "/prescriptions/cancelled",
  getCancelledPrescriptions
);

// ======================================================
// DAY END
// ======================================================

router.post(
  "/day-end/close",
  closeDay
);

router.get(
  "/day-end/reports",
  getReports
);

router.get(
  "/day-end/reports/:id",
  getReportById
);

// ======================================================
// OPD
// ======================================================

router.post(
  "/opd/start",
  startOpd
);

router.post(
  "/opd/end",
  endOpd
);
router.get(
  "/opd/today",
  getTodayOpd
);

module.exports = router;