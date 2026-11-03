const express = require("express");
const router = express.Router();

const { careerUpload } = require("../middleware/careerUpload");

const {
  submitContactEnquiry,
  applyForInternship,
} = require("../controllers/contactController");

// Contact enquiry
router.post("/", submitContactEnquiry);

// Internship application
router.post("/internships/apply", careerUpload, applyForInternship);

module.exports = router;
